'use strict';
// WP-C-1 + WP-C-2 (M2) + WP-C-4/C-5 (M5): opcua-client-config
// See: docs/milestones.md#m5--visual-ux--security
// See: docs/work-packages.md#wp-c-4-visueller-tree-view-browser
// See: docs/work-packages.md#wp-c-5-security--pki-ui

const {
  MessageSecurityMode,
  SecurityPolicy,
  BrowseDirection,
  NodeClass
} = require('node-opcua');
const path = require('path');
const { OpcuaClientFSM } = require('../../../lib/client/fsm');
const { BatchScheduler }  = require('../../../lib/client/batch-scheduler');
const { createClient }    = require('../../../lib/client/connection-manager');
const { reestablishOrCreateSession, reactivateSubscriptions, buildUserIdentity } = require('../../../lib/client/session-manager');
const { classifyError, ErrorCategory } = require('../../../lib/client/error-handler');
const { isValidConfigId, registerPkiRoutes } = require('../../../lib/http-helpers');
const {
  ensureClientCertificate,
  listRejectedCertificates,
  trustCertificate,
  listTrustedCertificates
} = require('../../../lib/client/pki-manager');

// ─── Security Mode / Policy helpers ─────────────────────────────────────────

const SECURITY_MODE_MAP = {
  None:           MessageSecurityMode.None,
  Sign:           MessageSecurityMode.Sign,
  SignAndEncrypt: MessageSecurityMode.SignAndEncrypt
};

const SECURITY_POLICY_MAP = {
  None:                  SecurityPolicy.None,
  Basic256Sha256:        SecurityPolicy.Basic256Sha256,
  Aes128_Sha256_RsaOaep: SecurityPolicy.Aes128_Sha256_RsaOaep,
  Aes256_Sha256_RsaPss:  SecurityPolicy.Aes256_Sha256_RsaPss
};

// ─── Node-RED Registration ───────────────────────────────────────────────────

module.exports = function (RED) {

  function OpcuaClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.fsm            = new OpcuaClientFSM();
    node.client         = null;
    node.session        = null;
    node.scheduler      = null;
    node.subscriptions  = []; // Track active subscriptions for reactivation after reconnect
    node.clientEventHandlers = null;
    node.sessionClosedHandler = null;

    // WP-C-5 (M5): PKI directory — stores client certificates
    const userDir = RED.settings.userDir || process.cwd();
    node.pkiDir  = config.pkiDir || path.join(userDir, 'opcua-pki', 'client');

    const securityMode   = SECURITY_MODE_MAP[config.securityMode]   || MessageSecurityMode.SignAndEncrypt;
    const securityPolicy = SECURITY_POLICY_MAP[config.securityPolicy] || SecurityPolicy.Basic256Sha256;

    if (securityMode === MessageSecurityMode.None) {
      node.warn('Security Mode "None" is active — connection is unencrypted. Do not use in production.');
    }

    // Helper: get user identity from credentials
    function getUserIdentity() {
      return buildUserIdentity(config, node.credentials || {});
    }

    // ── Connection setup ───────────────────────────────────────────────────
    async function connect() {
      node.fsm.transition('CONNECTING');

      // WP-C-5 (M5): Auto-generate PKI certificate on first run
      const appName = config.applicationName || 'Node-RED OPC UA Client';
      let certOpts = {};
      if (securityMode !== MessageSecurityMode.None) {
        try {
          const { certFile, keyFile } = await ensureClientCertificate(node.pkiDir, appName);
          certOpts = { certificateFile: certFile, privateKeyFile: keyFile };
        } catch (err) {
          node.warn(`PKI certificate setup failed: ${err.message} — connecting without client certificate`);
        }
      }

      node.client = createClient({
        applicationName:         appName,
        securityMode,
        securityPolicy,
        ...certOpts,
        requestedSessionTimeout: config.requestedSessionTimeout
      });

      // ── node-opcua reconnect events → FSM transitions ──────────────────
      node.clientEventHandlers = {
        connection_lost: () => {
          if (node.fsm.state === 'SESSION_ACTIVE' || node.fsm.state === 'CONNECTED') {
            try { node.fsm.transition('CONNECTION_LOST'); } catch (_) { /* guard */ }
          }
          node.warn('OPC UA connection lost — reconnect will start automatically');
          // Destroy scheduler on disconnect (requests will fail anyway)
          if (node.scheduler) {
            node.scheduler.destroy();
            node.scheduler = null;
          }
        },

        reconnecting: () => {
          if (node.fsm.state === 'CONNECTION_LOST') {
            try { node.fsm.transition('RECONNECTING'); } catch (_) { /* guard */ }
          }
        },

        connection_reestablished: () => {
          if (node.fsm.state === 'RECONNECTING' || node.fsm.state === 'CONNECTION_LOST') {
            try { node.fsm.transition('CONNECTED'); } catch (_) { /* guard */ }
          }
          node.log('OPC UA connection re-established');
        },

        after_reconnection: async () => {
          // WP-C-2: Attempt session re-establishment before creating a new one
          try {
            await activateSession();
          } catch (err) {
            node.warn(`Post-reconnect session activation failed: ${err.message}`);
          }
        }
      };

      Object.entries(node.clientEventHandlers)
        .forEach(([event, handler]) => node.client.on(event, handler));

      await node.client.connect(config.endpoint);
      node.fsm.transition('CONNECTED');
      await activateSession();
    }

    async function activateSession() {
      try {
        const userIdentity = getUserIdentity();

        // Remove stale session_closed listener from previous session to prevent accumulation
        let previousSession = null;
        if (node.session) {
          if (node.sessionClosedHandler) {
            node.session.removeListener('session_closed', node.sessionClosedHandler);
            node.sessionClosedHandler = null;
          }
          // Preserve node-opcua/internal listeners; this config node only owns sessionClosedHandler.
          previousSession = node.session;
          node.session = null;
        }

        node.session = await reestablishOrCreateSession(
          previousSession, node.client, userIdentity
        );

        node.sessionClosedHandler = () => {
          if (node.fsm.state === 'SESSION_ACTIVE') {
            try { node.fsm.transition('CONNECTION_LOST'); } catch (_) { /* guard */ }
          }
        };
        node.session.on('session_closed', node.sessionClosedHandler);

        // Create/recreate the BatchScheduler for the new/reactivated session
        if (node.scheduler) node.scheduler.destroy();
        node.scheduler = new BatchScheduler(node.session);

        node.fsm.transition('SESSION_ACTIVE');

        // Reactivate subscriptions from previous session
        if (node.subscriptions.length > 0) {
          const { expired } = await reactivateSubscriptions(node.subscriptions, node);
          // Remove expired subscriptions — worker nodes will be notified to recreate
          node.subscriptions = node.subscriptions.filter(s => !expired.includes(s));
          node.emit('subscriptionsReactivated', { expired });
        }
      } catch (err) {
        const { category, statusCodeName } = classifyError(err);
        if (category === ErrorCategory.LIMIT) {
          node.error(`[CRITICAL] ${statusCodeName}: ${err.message} — session limit reached`);
        } else if (category === ErrorCategory.AUTH) {
          node.error(`[AUTH] ${statusCodeName}: ${err.message} — auto-retry disabled`);
        } else {
          node.error(`Session activation failed: ${err.message}`);
        }
      }
    }

    // ── Public API for worker nodes ───────────────────────────────────────

    /**
     * Register a subscription so it can be reactivated after reconnect.
     * @param {ClientSubscription} subscription
     */
    node.registerSubscription = function (subscription) {
      node.subscriptions.push(subscription);
    };

    /**
     * Unregister a subscription (e.g. on node close).
     * @param {ClientSubscription} subscription
     */
    node.unregisterSubscription = function (subscription) {
      node.subscriptions = node.subscriptions.filter(s => s !== subscription);
    };

    // ── Graceful shutdown ─────────────────────────────────────────────────
    node.on('close', async (_removed, done) => {
      try {
        if (node.scheduler) {
          node.scheduler.destroy();
          node.scheduler = null;
        }
        if (node.session) {
          if (node.sessionClosedHandler) {
            node.session.removeListener('session_closed', node.sessionClosedHandler);
            node.sessionClosedHandler = null;
          }
          await node.session.close();
          node.session = null;
        }
        if (node.client) {
          if (node.clientEventHandlers) {
            Object.entries(node.clientEventHandlers)
              .forEach(([event, handler]) => node.client.removeListener(event, handler));
            node.clientEventHandlers = null;
          }
          await node.client.disconnect();
          node.client = null;
        }
      } catch (err) {
        node.warn(`Disconnect error: ${err.message}`);
      } finally {
        node.subscriptions = [];
        if (node.fsm.state !== 'DISCONNECTED') {
          try { node.fsm.transition('DISCONNECTED'); } catch (_) { /* guard */ }
        }
        done();
      }
    });

    // ── Start on deploy ───────────────────────────────────────────────────
    connect().catch(err => {
      const { category, statusCodeName } = classifyError(err);
      if (category === ErrorCategory.AUTH) {
        node.error(`[AUTH] Initial connect failed: ${statusCodeName} — ${err.message}`);
      } else if (category === ErrorCategory.LIMIT) {
        node.error(`[CRITICAL] Initial connect failed: ${statusCodeName} — ${err.message}`);
      } else {
        node.error(`Initial connect failed: ${err.message}`);
      }
      if (node.fsm.state === 'CONNECTING') {
        try { node.fsm.transition('DISCONNECTED'); } catch (_) { /* guard */ }
      }
    });
  }

  RED.nodes.registerType('opcua-client-config', OpcuaClientConfig, {
    credentials: {
      username: { type: 'text' },
      password: { type: 'password' }
    }
  });

  // ── WP-C-4 (M5): Browse Route for Address Space Browser ──────────────
  RED.httpAdmin.get(
    '/opcua-admin/browse',
    RED.auth.needsPermission('opcua-client-config.write'),
    async (req, res) => {
      const { configId } = req.query;
      let { nodeId } = req.query;
      nodeId = nodeId || 'RootFolder';

      // Input validation: configId must be alphanumeric + dots
      if (!configId || !isValidConfigId(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }

      // Validate nodeId: reject path traversal patterns and shell metacharacters
      if (typeof nodeId !== 'string' || /[<>{}|\\`]/.test(nodeId)) {
        return res.status(400).json({ error: 'Invalid nodeId' });
      }

      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode.session) {
        return res.status(503).json({ error: 'No active session available' });
      }

      try {
        const browseResult = await configNode.session.browse({
          nodeId,
          browseDirection: BrowseDirection.Forward,
          includeSubtypes: true,
          nodeClassMask:   0,
          resultMask:      63
        });

        const nodes = (browseResult.references || []).map(ref => ({
          nodeId:      ref.nodeId.toString(),
          displayName: ref.displayName ? ref.displayName.text : '',
          browseName:  ref.browseName  ? ref.browseName.name  : '',
          nodeClass:   NodeClass[ref.nodeClass] || 'Unknown',
          hasChildren: ref.nodeClass === NodeClass.Object ||
                       ref.nodeClass === NodeClass.View
        }));

        res.json(nodes);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── WP-C-5 (M5): PKI HTTP Routes ─────────────────────────────────────

  registerPkiRoutes(RED, {
    basePath:     '/opcua-admin/pki',
    permission:   'opcua-client-config',
    listRejected: listRejectedCertificates,
    listTrusted:  listTrustedCertificates,
    trust:        trustCertificate
  });
};

'use strict';
// WP-C-1 + WP-C-2 (M2): opcua-client-config — Central Connection Manager (FSM + Batching)
// See: docs/milestones.md#m2--resilience--core-data
// See: docs/work-packages.md#wp-c-1-basis-infrastruktur--configuration-node
// See: docs/work-packages.md#wp-c-2-resilience-engineering-session--error-management

const {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  UserTokenType
} = require('node-opcua');
const { OpcuaClientFSM } = require('../../../lib/client/fsm');
const { BatchScheduler }  = require('../../../lib/client/batch-scheduler');
const { reestablishOrCreateSession, reactivateSubscriptions, buildUserIdentity } = require('../../../lib/client/session-manager');
const { classifyError, ErrorCategory } = require('../../../lib/client/error-handler');

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

      node.client = OPCUAClient.create({
        applicationName:    config.applicationName || 'Node-RED OPC UA Client',
        connectionStrategy: {
          initialDelay:        1000,
          maxDelay:            30000,
          maxRetry:            Infinity,
          randomisationFactor: 0.1
        },
        securityMode,
        securityPolicy,
        // WP-C-5 (M5) will supply certificateFile / privateKeyFile from pki-manager
        keepSessionAlive:        true,
        requestedSessionTimeout: config.requestedSessionTimeout || 60000
      });

      // ── node-opcua reconnect events → FSM transitions ──────────────────
      node.client.on('connection_lost', () => {
        if (node.fsm.state === 'SESSION_ACTIVE' || node.fsm.state === 'CONNECTED') {
          try { node.fsm.transition('CONNECTION_LOST'); } catch (_) { /* guard */ }
        }
        node.warn('OPC UA connection lost — reconnect will start automatically');
        // Destroy scheduler on disconnect (requests will fail anyway)
        if (node.scheduler) {
          node.scheduler.destroy();
          node.scheduler = null;
        }
      });

      node.client.on('reconnecting', () => {
        if (node.fsm.state === 'CONNECTION_LOST') {
          try { node.fsm.transition('RECONNECTING'); } catch (_) { /* guard */ }
        }
      });

      node.client.on('connection_reestablished', () => {
        if (node.fsm.state === 'RECONNECTING' || node.fsm.state === 'CONNECTION_LOST') {
          try { node.fsm.transition('CONNECTED'); } catch (_) { /* guard */ }
        }
        node.log('OPC UA connection re-established');
      });

      node.client.on('after_reconnection', async () => {
        // WP-C-2: Attempt session re-establishment before creating a new one
        await activateSession();
      });

      await node.client.connect(config.endpoint);
      node.fsm.transition('CONNECTED');
      await activateSession();
    }

    async function activateSession() {
      try {
        const userIdentity = getUserIdentity();
        node.session = await reestablishOrCreateSession(
          node.session, node.client, userIdentity
        );

        node.session.on('session_closed', () => {
          if (node.fsm.state === 'SESSION_ACTIVE') {
            try { node.fsm.transition('CONNECTION_LOST'); } catch (_) { /* guard */ }
          }
        });

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
          await node.session.close();
          node.session = null;
        }
        if (node.client) {
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

  // WP-C-4 (M5): register RED.httpAdmin browse route
  // WP-C-5 (M5): register RED.httpAdmin PKI routes
};

// FSM is re-exported for convenience — tests should import from lib/client/fsm directly
module.exports.OpcuaClientFSM = OpcuaClientFSM;

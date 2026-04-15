'use strict';
// WP-C-1 (M1): opcua-client-config — Central Connection Manager (Finite State Machine)
// See: docs/milestones.md#m1--foundation
// See: docs/work-packages.md#wp-c-1-basis-infrastruktur--configuration-node
// See: docs/theoretical-foundations.md#10-node-red-architektur-und-low-code-paradigma

const {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  UserTokenType
} = require('node-opcua');
const { OpcuaClientFSM } = require('../../../lib/client/fsm');

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

function buildUserIdentity(config, credentials) {
  if (config.authMode === 'UserName') {
    return {
      type:     UserTokenType.UserName,
      userName: credentials.username || '',
      password: credentials.password || ''
    };
  }
  return { type: UserTokenType.Anonymous };
}

// ─── Node-RED Registration ───────────────────────────────────────────────────

module.exports = function (RED) {

  function OpcuaClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.fsm       = new OpcuaClientFSM();
    node.client    = null;
    node.session   = null;
    node.scheduler = null; // Initialized in WP-C-3 (M2)

    const securityMode   = SECURITY_MODE_MAP[config.securityMode]   || MessageSecurityMode.SignAndEncrypt;
    const securityPolicy = SECURITY_POLICY_MAP[config.securityPolicy] || SecurityPolicy.Basic256Sha256;

    if (securityMode === MessageSecurityMode.None) {
      node.warn('Security Mode "None" is active — connection is unencrypted. Do not use in production.');
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
        keepSessionAlive: true
      });

      // FSM events from node-opcua internal reconnect machinery
      node.client.on('connection_lost', () => {
        if (node.fsm.state === 'SESSION_ACTIVE' || node.fsm.state === 'CONNECTED') {
          node.fsm.transition('CONNECTION_LOST');
        }
      });

      node.client.on('reconnecting', () => {
        if (node.fsm.state === 'CONNECTION_LOST') {
          node.fsm.transition('RECONNECTING');
        }
      });

      node.client.on('connection_reestablished', () => {
        if (node.fsm.state === 'RECONNECTING' || node.fsm.state === 'CONNECTION_LOST') {
          node.fsm.transition('CONNECTED');
        }
      });

      node.client.on('after_reconnection', async () => {
        // WP-C-2 (M2): attempt session re-establishment before creating a new one
        await activateSession();
      });

      await node.client.connect(config.endpoint);
      node.fsm.transition('CONNECTED');
      await activateSession();
    }

    async function activateSession() {
      try {
        node.session = await node.client.createSession(
          buildUserIdentity(config, node.credentials || {})
        );
        node.session.on('session_closed', () => {
          if (node.fsm.state === 'SESSION_ACTIVE') {
            node.fsm.transition('CONNECTION_LOST');
          }
        });
        node.fsm.transition('SESSION_ACTIVE');
      } catch (err) {
        node.error(`Session activation failed: ${err.message}`);
      }
    }

    // ── Graceful shutdown ─────────────────────────────────────────────────
    node.on('close', async (_removed, done) => {
      // WP-C-2 (M2): scheduler cleanup will be added here
      try {
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
        if (node.fsm.state !== 'DISCONNECTED') {
          node.fsm.transition('DISCONNECTED');
        }
        done();
      }
    });

    // ── Start on deploy ───────────────────────────────────────────────────
    connect().catch(err => {
      node.error(`Initial connect failed: ${err.message}`);
      if (node.fsm.state === 'CONNECTING') {
        node.fsm.transition('DISCONNECTED');
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

'use strict';
// WP-S-1 + WP-S-5 + WP-S-6 (M7): opcua-server-config
// Server lifecycle + PKI + Security, Identity, Auth, Resource Limits.
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management
// See: docs/work-packages.md#wp-s-5-server-pki--rbac
// See: docs/work-packages.md#wp-s-6-server-security--identity-configuration

const {
  OPCUAServer,
  MessageSecurityMode,
  SecurityPolicy
} = require('node-opcua');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { importNodeSets }                     = require('../../../lib/server/nodeset-importer');
const { registerPkiRoutes, isValidConfigId } = require('../../../lib/http-helpers');
const {
  ensureServerCertificate,
  listRejectedClientCertificates,
  trustClientCertificate,
  listTrustedClientCertificates
} = require('../../../lib/server/pki-manager');
const { buildUserManagerFromCredentials } = require('../../../lib/server/user-manager');

// ── Security option mapping ──────────────────────────────────────────────────

const POLICY_MAP = {
  None:                  SecurityPolicy.None,
  Basic128Rsa15:         SecurityPolicy.Basic128Rsa15,
  Basic256:              SecurityPolicy.Basic256,
  Basic256Sha256:        SecurityPolicy.Basic256Sha256,
  Aes128_Sha256_RsaOaep: SecurityPolicy.Aes128_Sha256_RsaOaep,
  Aes256_Sha256_RsaPss:  SecurityPolicy.Aes256_Sha256_RsaPss
};

const MODE_MAP = {
  None:           MessageSecurityMode.None,
  Sign:           MessageSecurityMode.Sign,
  SignAndEncrypt: MessageSecurityMode.SignAndEncrypt
};

function splitToNames(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Convert config values into the subset of OPCUAServer options that govern
 * endpoint security. Unknown names are silently dropped so a typo never
 * prevents the server from starting.
 */
function buildSecurityOptions(config) {
  const policyNames = splitToNames(config.securityPolicies);
  const modeNames   = splitToNames(config.securityModes);

  const securityPolicies = policyNames.map(p => POLICY_MAP[p]).filter(Boolean);
  const securityModes    = modeNames.map(m => MODE_MAP[m]).filter(v => v !== undefined);

  // Node-RED stores unchecked checkboxes as 'false' string; treat missing as true.
  const allowAnonymous = !(config.allowAnonymous === false || config.allowAnonymous === 'false');

  const out = { allowAnonymous };
  if (securityPolicies.length) out.securityPolicies = securityPolicies;
  if (securityModes.length)    out.securityModes    = securityModes;
  return out;
}

/**
 * Build OPCUAServer `buildInfo` + `serverInfo` identity blocks from config.
 * Only fields that the user actually filled in are forwarded — this keeps
 * node-opcua's own sensible defaults in place for empty values.
 */
function buildIdentityOptions(config, productName) {
  const buildInfo = {
    productName,
    buildDate: new Date()
  };
  if (config.productUri)       buildInfo.productUri       = config.productUri;
  if (config.manufacturerName) buildInfo.manufacturerName = config.manufacturerName;
  if (config.softwareVersion)  buildInfo.softwareVersion  = config.softwareVersion;
  if (config.buildNumber)      buildInfo.buildNumber      = config.buildNumber;

  const hostname = os.hostname();
  const serverInfo = {
    applicationUri: config.applicationUri
      || `urn:${hostname}:NodeRED:${productName.replace(/\s+/g, '')}`
  };
  if (config.productUri) serverInfo.productUri = config.productUri;

  return { buildInfo, serverInfo };
}

/**
 * Build the resource-limit blocks (serverCapabilities + maxConnectionsPerEndpoint).
 * Applies only the limits explicitly configured by the user.
 */
function buildResourceLimits(config) {
  const toPosInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const maxSessions         = toPosInt(config.maxSessions);
  const maxSubscriptions    = toPosInt(config.maxSubscriptions);
  const maxMonitoredItems   = toPosInt(config.maxMonitoredItems);
  const sessionTimeoutMs    = toPosInt(config.sessionTimeout);
  const minSamplingInterval = toPosInt(config.minSamplingInterval);

  const serverCapabilities = {};
  const operationLimits    = {};
  if (maxSessions)         serverCapabilities.maxSessions        = maxSessions;
  if (maxSubscriptions)    serverCapabilities.maxSubscriptions   = maxSubscriptions;
  if (maxMonitoredItems)   serverCapabilities.maxMonitoredItems  = maxMonitoredItems;
  if (minSamplingInterval) operationLimits.minSupportedSampleRate = minSamplingInterval;
  if (Object.keys(operationLimits).length) serverCapabilities.operationLimits = operationLimits;

  const out = {};
  if (Object.keys(serverCapabilities).length) out.serverCapabilities = serverCapabilities;
  if (maxSessions)      out.maxConnectionsPerEndpoint = maxSessions;
  if (sessionTimeoutMs) out.defaultSessionTimeout     = sessionTimeoutMs;
  return out;
}

// ── Node registration ────────────────────────────────────────────────────────

module.exports = function (RED) {
  function OpcuaServerConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server       = null;
    node.addressSpace = null;

    // WP-S-5 (M5): PKI directory for server certificates
    const userDir = RED.settings.userDir || process.cwd();
    node.pkiDir   = config.pkiDir || path.join(userDir, 'opcua-pki', 'server');

    // Precompute option blocks — exposed for tests and introspection.
    node.securityOptions = buildSecurityOptions(config);
    node.resourceLimits  = buildResourceLimits(config);

    function parseNodeSetPaths(rawNodeSets) {
      if (!rawNodeSets || typeof rawNodeSets !== 'string') return [];
      return rawNodeSets
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
    }

    async function startServer() {
      const productName = config.productName || 'Node-RED OPC UA Server';
      const serverPort  = parseInt(config.port, 10) || 4840;

      // WP-S-5: Auto-generate / reuse server certificate
      let certOpts = {};
      try {
        const { certFile, keyFile } = await ensureServerCertificate(
          node.pkiDir, productName
        );
        certOpts = { certificateFile: certFile, privateKeyFile: keyFile };
        node.ownCertFile = certFile;
      } catch (err) {
        node.warn(`Server PKI setup failed: ${err.message} — starting without custom certificate`);
      }

      // WP-S-6: Username/password authentication from encrypted credentials
      const userManager = buildUserManagerFromCredentials(node.credentials?.users);
      node.userManager  = userManager;

      const identity = buildIdentityOptions(config, productName);

      node.server = new OPCUAServer({
        port:         serverPort,
        resourcePath: config.resourcePath || '/UA/NodeRED',
        buildInfo:    identity.buildInfo,
        serverInfo:   identity.serverInfo,
        ...node.securityOptions,
        ...node.resourceLimits,
        ...(userManager ? { userManager } : {}),
        ...certOpts
      });

      await node.server.initialize();
      node.addressSpace = node.server.engine.addressSpace;
      await importNodeSets(node.addressSpace, parseNodeSetPaths(config.nodeSets));
      // Signal to address-space-builder nodes (WP-S-2)
      node.emit('addressSpaceReady', node.addressSpace);
      await node.server.start();

      node.endpointUrl = `opc.tcp://${os.hostname()}:${serverPort}${config.resourcePath || '/UA/NodeRED'}`;
      node.status({ fill: 'green', shape: 'dot', text: `Port ${serverPort}: Active` });
    }

    node.on('close', async (_removed, done) => {
      if (node.server) {
        try {
          // CRITICAL: Must release TCP port on redeploy — prevents EADDRINUSE
          await node.server.shutdown(2000);
        } catch (err) {
          node.warn(`Server shutdown error: ${err.message}`);
        } finally {
          node.server = null;
          node.addressSpace = null;
        }
      }
      done();
    });

    startServer().catch(err => {
      node.error(`Server start failed: ${err.message}`);
      node.status({ fill: 'red', shape: 'dot', text: `Start failed: ${err.message}` });
    });
  }

  RED.nodes.registerType('opcua-server-config', OpcuaServerConfig, {
    credentials: {
      // JSON-serialised array of { username, password, role } — encrypted by Node-RED.
      users: { type: 'text' }
    }
  });

  // ── WP-S-5 (M5): Server PKI HTTP Routes ──────────────────────────────
  registerPkiRoutes(RED, {
    basePath:     '/opcua-admin/server-pki',
    permission:   'opcua-server-config',
    listRejected: listRejectedClientCertificates,
    listTrusted:  listTrustedClientCertificates,
    trust:        trustClientCertificate
  });

  // ── WP-S-6 (M7): Server Certificate Download ─────────────────────────
  // Returns the server's own self-signed certificate (.der/.pem) so integrators
  // can hand it to clients that require explicit trust.
  RED.httpAdmin.get(
    '/opcua-admin/server-pki/own-cert',
    RED.auth.needsPermission('opcua-server-config.read'),
    (req, res) => {
      const { configId } = req.query;
      if (!configId || !isValidConfigId(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode.pkiDir) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        const certDir = path.join(configNode.pkiDir, 'own', 'certs');
        if (!fs.existsSync(certDir)) {
          return res.status(404).json({ error: 'No server certificate available' });
        }
        const candidates = fs.readdirSync(certDir)
          .filter(f => f.endsWith('.pem') || f.endsWith('.der'));
        if (!candidates.length) {
          return res.status(404).json({ error: 'No server certificate available' });
        }
        const certPath = path.join(certDir, candidates[0]);
        const data = fs.readFileSync(certPath);
        res.setHeader('Content-Type', 'application/pkix-cert');
        res.setHeader('Content-Disposition', `attachment; filename="${candidates[0]}"`);
        res.status(200).send(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};

// Pure helpers exposed for unit tests (importable without invoking the factory).
module.exports._internals = {
  buildSecurityOptions,
  buildIdentityOptions,
  buildResourceLimits,
  POLICY_MAP,
  MODE_MAP
};

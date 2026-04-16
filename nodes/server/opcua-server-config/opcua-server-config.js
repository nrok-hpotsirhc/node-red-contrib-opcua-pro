'use strict';
// WP-S-1 + WP-S-5 (M5): opcua-server-config — OPC UA Server lifecycle manager + PKI
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management
// See: docs/work-packages.md#wp-s-5-server-pki--rbac

const { OPCUAServer } = require('node-opcua');
const path = require('path');
const { importNodeSets } = require('../../../lib/server/nodeset-importer');
const { isValidConfigId, registerPkiRoutes } = require('../../../lib/http-helpers');
const {
  ensureServerCertificate,
  listRejectedClientCertificates,
  trustClientCertificate,
  listTrustedClientCertificates
} = require('../../../lib/server/pki-manager');

module.exports = function (RED) {
  function OpcuaServerConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server       = null;
    node.addressSpace = null;

    // WP-S-5 (M5): PKI directory for server certificates
    const userDir = RED.settings.userDir || process.cwd();
    node.pkiDir  = config.pkiDir || path.join(userDir, 'opcua-pki', 'server');

    function parseNodeSetPaths(rawNodeSets) {
      if (!rawNodeSets || typeof rawNodeSets !== 'string') return [];
      return rawNodeSets
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
    }

    async function startServer() {
      // WP-S-5 (M5): Auto-generate server certificate
      const productName = config.productName || 'Node-RED OPC UA Server';
      const serverPort  = parseInt(config.port) || 4840;
      let certOpts = {};
      try {
        const { certFile, keyFile } = await ensureServerCertificate(
          node.pkiDir, productName
        );
        certOpts = { certificateFile: certFile, privateKeyFile: keyFile };
      } catch (err) {
        node.warn(`Server PKI setup failed: ${err.message} — starting without custom certificate`);
      }

      node.server = new OPCUAServer({
        port:         serverPort,
        resourcePath: config.resourcePath || '/UA/NodeRED',
        buildInfo: {
          productName
        },
        ...certOpts
      });

      await node.server.initialize();
      node.addressSpace = node.server.engine.addressSpace;
      await importNodeSets(node.addressSpace, parseNodeSetPaths(config.nodeSets));
      // Signal to address-space-builder nodes (WP-S-2)
      node.emit('addressSpaceReady', node.addressSpace);
      await node.server.start();
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

  RED.nodes.registerType('opcua-server-config', OpcuaServerConfig);

  // ── WP-S-5 (M5): Server PKI HTTP Routes ──────────────────────────────

  registerPkiRoutes(RED, {
    basePath:     '/opcua-admin/server-pki',
    permission:   'opcua-server-config',
    listRejected: listRejectedClientCertificates,
    listTrusted:  listTrustedClientCertificates,
    trust:        trustClientCertificate
  });
};

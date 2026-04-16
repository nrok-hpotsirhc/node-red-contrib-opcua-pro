'use strict';
// WP-S-1 + WP-S-5 (M5): opcua-server-config — OPC UA Server lifecycle manager + PKI
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management
// See: docs/work-packages.md#wp-s-5-server-pki--rbac

const { OPCUAServer } = require('node-opcua');
const path = require('path');
const { importNodeSets } = require('../../../lib/server/nodeset-importer');
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

  // List rejected client certificates
  RED.httpAdmin.get(
    '/opcua-admin/server-pki/rejected',
    RED.auth.needsPermission('opcua-server-config.write'),
    (req, res) => {
      const { configId } = req.query;
      if (!configId || !/^[a-z0-9.]+$/i.test(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode.pkiDir) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        const files = listRejectedClientCertificates(configNode.pkiDir);
        res.json(files.map(f => ({ name: f })));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // List trusted client certificates
  RED.httpAdmin.get(
    '/opcua-admin/server-pki/trusted',
    RED.auth.needsPermission('opcua-server-config.read'),
    (req, res) => {
      const { configId } = req.query;
      if (!configId || !/^[a-z0-9.]+$/i.test(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode.pkiDir) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        const files = listTrustedClientCertificates(configNode.pkiDir);
        res.json(files.map(f => ({ name: f })));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Trust a rejected client certificate
  RED.httpAdmin.post(
    '/opcua-admin/server-pki/trust',
    RED.auth.needsPermission('opcua-server-config.write'),
    (req, res) => {
      const { configId, filename } = req.body || {};
      if (!configId || !/^[a-z0-9.]+$/i.test(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Missing filename' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode.pkiDir) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        trustClientCertificate(configNode.pkiDir, filename);
        res.json({ success: true });
      } catch (err) {
        if (err.message.includes('Invalid certificate filename')) {
          return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );
};

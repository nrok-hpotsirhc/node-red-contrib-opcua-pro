'use strict';
// WP-S-1: opcua-server-config — OPC UA Server lifecycle manager (Config Node)
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management
// See: docs/theoretical-foundations.md#10-node-red-architektur-und-low-code-paradigma

const { OPCUAServer } = require('node-opcua');
const { importNodeSets } = require('../../../lib/server/nodeset-importer');

module.exports = function (RED) {
  function OpcuaServerConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server       = null;
    node.addressSpace = null;

    function parseNodeSetPaths(rawNodeSets) {
      if (!rawNodeSets || typeof rawNodeSets !== 'string') return [];
      return rawNodeSets
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
    }

    async function startServer() {
      node.server = new OPCUAServer({
        port:         parseInt(config.port) || 4840,
        resourcePath: config.resourcePath || '/UA/NodeRED',
        buildInfo: {
          productName: config.productName || 'Node-RED OPC UA Server'
        }
      });

      // TODO WP-S-5: Configure PKI / security policies
      await node.server.initialize();
      node.addressSpace = node.server.engine.addressSpace;
      await importNodeSets(node.addressSpace, parseNodeSetPaths(config.nodeSets));
      // Signal to address-space-builder nodes (WP-S-2)
      node.emit('addressSpaceReady', node.addressSpace);
      // TODO WP-S-5: Configure PKI / security policies
      await node.server.start();
      node.status({ fill: 'green', shape: 'dot', text: `Port ${config.port || 4840}: Active` });
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
};

'use strict';
// WP-S-2: opcua-folder — Programmatic Address Space folder node
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge

module.exports = function (RED) {
  function OpcuaFolder(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    node.serverConfig.on('addressSpaceReady', (addressSpace) => {
      try {
        const namespace = addressSpace.getOwnNamespace();
        const parent    = config.parentNodeId
          ? addressSpace.findNode(config.parentNodeId)
          : addressSpace.rootFolder.objects;

        // TODO WP-S-2: Create folder and expose reference for child nodes
        // node.folder = namespace.addFolder(parent, { browseName: config.browseName });
        node.status({ fill: 'green', shape: 'dot', text: config.browseName });
      } catch (err) {
        node.error(`Failed to create folder: ${err.message}`);
      }
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-folder', OpcuaFolder);
};

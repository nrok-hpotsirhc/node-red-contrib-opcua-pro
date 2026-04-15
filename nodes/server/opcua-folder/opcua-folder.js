'use strict';
// WP-S-2: opcua-folder — Programmatic Address Space folder node
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge

module.exports = function (RED) {
  function OpcuaFolder(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.folder = null;

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    const setupFolder = (addressSpace) => {
      try {
        const namespace = addressSpace.getOwnNamespace();
        let parent = addressSpace.rootFolder.objects;

        if (config.parentFolder) {
          const parentFolderNode = RED.nodes.getNode(config.parentFolder);
          if (parentFolderNode?.folder) {
            parent = parentFolderNode.folder;
          }
        } else if (config.parentNodeId) {
          parent = addressSpace.findNode(config.parentNodeId) || addressSpace.rootFolder.objects;
        }

        node.folder = namespace.addFolder(parent, {
          browseName: config.browseName || node.name || 'Folder',
          nodeId: config.nodeId || undefined
        });
        node.status({ fill: 'green', shape: 'dot', text: config.browseName });
      } catch (err) {
        node.error(`Failed to create folder: ${err.message}`);
      }
    };

    node.serverConfig.on('addressSpaceReady', setupFolder);
    if (node.serverConfig.addressSpace) {
      setupFolder(node.serverConfig.addressSpace);
    }

    node.on('close', (_removed, done) => {
      node.serverConfig.removeListener('addressSpaceReady', setupFolder);
      done();
    });
  }

  RED.nodes.registerType('opcua-folder', OpcuaFolder);
};

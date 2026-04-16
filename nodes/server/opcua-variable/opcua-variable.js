'use strict';
// WP-S-2: opcua-variable — Context-bridged OPC UA variable node
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge
// See: docs/theoretical-foundations.md#context-mapping-die-bidirektionale-datenbrücke

const { createVariableBinding } = require('../../../lib/server/context-bridge');

/**
 * Parse the defaultValue string from the HTML config into a typed value
 * matching the configured OPC UA data type.
 */
function parseDefaultValue(raw, dataType) {
  if (raw === null || raw === undefined) return undefined;
  // For String type, empty string is a valid default value
  if (dataType === 'String') return String(raw);
  if (raw === '') return undefined;
  switch (dataType) {
  case 'Boolean':
    return raw === 'true' || raw === true;
  case 'Double':
  case 'Float': {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  case 'SByte':
  case 'Byte':
  case 'Int16':
  case 'Int32':
  case 'Int64':
  case 'UInt16':
  case 'UInt32':
  case 'UInt64': {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  default:
    return raw;
  }
}

module.exports = function (RED) {
  function resolveParentNode(config, addressSpace) {
    const parentFolderNode = config.parentFolder ? RED.nodes.getNode(config.parentFolder) : null;
    return parentFolderNode?.folder
      || (config.parentNodeId ? addressSpace.findNode(config.parentNodeId) : null)
      || addressSpace.rootFolder.objects;
  }

  function OpcuaVariable(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.variable = null;

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    const setupVariable = (addressSpace) => {
      if (node.variable) return;
      if (!addressSpace) {
        node.error('Address space is not available');
        node.status({ fill: 'red', shape: 'ring', text: 'No address space' });
        return;
      }
      try {
        const parentNode = resolveParentNode(config, addressSpace);

        const contextScope = config.contextScope === 'global' ? 'global' : 'flow';
        const contextStore = config.contextStore || undefined;
        const nodeContext = node.context();
        const contextApi = contextScope === 'global' ? nodeContext.global : nodeContext.flow;

        const flowContext = {
          get: (key) => contextApi.get(key, contextStore),
          set: (key, value) => contextApi.set(key, value, contextStore)
        };

        const parsedDefault = parseDefaultValue(config.defaultValue, config.dataType || 'Double');

        node.variable = createVariableBinding(
          addressSpace.getOwnNamespace(),
          parentNode,
          {
            browseName: config.browseName || node.name || 'Variable',
            dataType: config.dataType || 'Double',
            contextKey: config.contextKey,
            defaultValue: parsedDefault,
            triggerOnWrite: Boolean(config.triggerOnWrite),
            nodeId: config.nodeId,
            minimumSamplingInterval: config.minimumSamplingInterval != null
              ? parseInt(config.minimumSamplingInterval, 10)
              : 1000
          },
          flowContext,
          node
        );
        node.status({ fill: 'green', shape: 'dot', text: config.browseName });
      } catch (err) {
        node.error(`Failed to create variable: ${err.message}`);
        node.status({ fill: 'red', shape: 'dot', text: `Error: ${err.message}` });
      }
    };

    node.serverConfig.on('addressSpaceReady', setupVariable);
    if (node.serverConfig.addressSpace) {
      setupVariable(node.serverConfig.addressSpace);
    }

    node.on('close', (removed, done) => {
      node.serverConfig.removeListener('addressSpaceReady', setupVariable);
      if (removed && node.variable?.dispose) {
        node.variable.dispose();
        node.variable = null;
      }
      done();
    });
  }

  RED.nodes.registerType('opcua-variable', OpcuaVariable);
};

'use strict';
// WP-S-2: opcua-variable — Context-bridged OPC UA variable node
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge
// See: docs/theoretical-foundations.md#context-mapping-die-bidirektionale-datenbrücke

module.exports = function (RED) {
  function OpcuaVariable(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    node.serverConfig.on('addressSpaceReady', (addressSpace) => {
      try {
        // TODO WP-S-2: Implement context bridge
        // namespace.addVariable({
        //   componentOf: parentNode,
        //   browseName:  config.browseName,
        //   dataType:    config.dataType,
        //   value: {
        //     get: () => new Variant({ dataType: ..., value: node.context().flow.get(config.contextKey) }),
        //     set: (variant) => {
        //       node.context().flow.set(config.contextKey, variant.value);
        //       if (config.triggerOnWrite) node.send({ payload: variant.value });
        //       return StatusCodes.Good;
        //     }
        //   }
        // });
        node.status({ fill: 'green', shape: 'dot', text: config.browseName });
      } catch (err) {
        node.error(`Failed to create variable: ${err.message}`);
      }
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-variable', OpcuaVariable);
};

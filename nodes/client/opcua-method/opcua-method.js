'use strict';
// WP-C-3: opcua-method — Client-side OPC UA Method Call node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#7-methods-und-remote-procedure-calls

module.exports = function (RED) {
  function OpcuaMethod(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode = RED.nodes.getNode(config.connection);
    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    node.on('input', async (msg, send, done) => {
      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active');
        return done();
      }
      // TODO WP-C-3: Call session.call({ objectId, methodId, inputArguments: msg.payload })
      // Normalize result → send({ payload: outputArguments, opcua: { statusCode } })
      done();
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-method', OpcuaMethod);
};

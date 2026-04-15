'use strict';
// WP-C-3: opcua-write — Smart-batching write worker node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching

module.exports = function (RED) {
  function OpcuaWrite(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode = RED.nodes.getNode(config.connection);
    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    node.on('input', async (msg, send, done) => {
      const nodeId = config.nodeId || msg.topic;
      const value  = msg.payload;

      if (!nodeId) { node.error('No NodeId configured', msg); return done(); }

      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active — dropping write request');
        return done();
      }

      // TODO WP-C-3: Submit to BatchScheduler
      done();
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-write', OpcuaWrite);
};

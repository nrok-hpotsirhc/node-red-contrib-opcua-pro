'use strict';
// WP-S-4: opcua-method-response — Correlated method response node
// See: docs/work-packages.md#wp-s-4-rpc-methoden--event-handling

module.exports = function (RED) {
  function OpcuaMethodResponse(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', (msg, _send, done) => {
      const correlationId = msg._opcua_method_id;
      if (!correlationId) {
        node.warn('msg._opcua_method_id missing — cannot correlate response');
        return done();
      }

      const methodNode = RED.nodes.getNode(config.methodNode);
      if (!methodNode?.pendingCalls) {
        node.warn('Linked opcua-server-method node not found');
        return done();
      }

      const pending = methodNode.pendingCalls.get(correlationId);
      if (pending) {
        clearTimeout(pending.timeout);
        methodNode.pendingCalls.delete(correlationId);
        pending.resolve(msg.payload);
      } else {
        node.warn(`No pending call found for _opcua_method_id: ${correlationId}`);
      }

      done();
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-method-response', OpcuaMethodResponse);
};

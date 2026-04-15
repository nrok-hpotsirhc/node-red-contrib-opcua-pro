'use strict';
// WP-S-4: opcua-server-method — Server-side RPC method trigger node
// See: docs/work-packages.md#wp-s-4-rpc-methoden--event-handling
// See: docs/theoretical-foundations.md#7-methods-und-remote-procedure-calls

const crypto = require('crypto');

module.exports = function (RED) {
  function OpcuaServerMethod(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Correlation table: UUID → { resolve, reject, timeout }
    node.pendingCalls = new Map();

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    node.serverConfig.on('addressSpaceReady', (addressSpace) => {
      // TODO WP-S-4: Register method in address space
      // namespace.addMethod(parentObject, {
      //   browseName: config.methodName,
      //   inputArguments: [...],
      //   outputArguments: [...]
      // });
      // parentObject[config.methodName] = async (inputArguments) => {
      //   const correlationId = crypto.randomUUID();
      //   return new Promise((resolve, reject) => {
      //     const timeout = setTimeout(() => {
      //       node.pendingCalls.delete(correlationId);
      //       reject(new Error('Method call timeout'));
      //     }, config.timeoutMs || 10000);
      //     node.pendingCalls.set(correlationId, { resolve, reject, timeout });
      //     node.send({ payload: inputArguments.map(a => a.value), _opcua_method_id: correlationId });
      //   });
      // };
    });

    node.on('close', (_removed, done) => {
      // Clean up pending calls to prevent memory leaks
      for (const [id, pending] of node.pendingCalls) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Node closed'));
      }
      node.pendingCalls.clear();
      done();
    });
  }

  RED.nodes.registerType('opcua-server-method', OpcuaServerMethod);
};

'use strict';
// WP-C-3 (M4): opcua-method — Client-side OPC UA Method Call node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#7-methods-und-remote-procedure-calls

const { STATUS_MAP } = require('../../../lib/client/node-status');

module.exports = function (RED) {
  function OpcuaMethod(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode = RED.nodes.getNode(config.connection);
    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    // ── Status propagation from FSM ───────────────────────────────────────
    function onStateChange(state) {
      node.status(STATUS_MAP[state] || { fill: 'grey', shape: 'ring', text: state });
    }
    node.configNode.fsm.on('stateChange', onStateChange);
    onStateChange(node.configNode.fsm.state);

    // ── Input handler: call OPC UA method ─────────────────────────────────
    node.on('input', async (msg, send, done) => {
      const objectId = config.objectId || msg.objectId;
      const methodId = config.methodId || msg.methodId;

      if (!objectId) {
        node.error('No objectId configured and no msg.objectId provided', msg);
        return done();
      }
      if (!methodId) {
        node.error('No methodId configured and no msg.methodId provided', msg);
        return done();
      }

      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active — dropping method call');
        return done();
      }

      if (!node.configNode.session) {
        node.warn('Session not available — dropping method call');
        return done();
      }

      try {
        // Build inputArguments: expect msg.payload as an array of Variant-like objects
        // or an array of plain values (which will be passed as-is to the OPC UA stack)
        const inputArguments = Array.isArray(msg.payload) ? msg.payload : [];

        const callResult = await node.configNode.session.call({
          objectId:       objectId,
          methodId:       methodId,
          inputArguments: inputArguments
        });

        // Normalize output arguments to plain values
        const outputArgs = (callResult.outputArguments || []).map(arg => {
          if (arg && typeof arg === 'object' && arg.value !== undefined) {
            return arg.value;
          }
          return arg;
        });

        msg.payload = outputArgs.length === 1 ? outputArgs[0] : outputArgs;
        msg.opcua = {
          objectId,
          methodId,
          statusCode: callResult.statusCode?.name
            || (callResult.statusCode?.value === 0 ? 'Good' : String(callResult.statusCode))
        };
        send(msg);
        done();
      } catch (err) {
        done(err);
      }
    });

    node.on('close', (_removed, done) => {
      node.configNode.fsm.removeListener('stateChange', onStateChange);
      done();
    });
  }

  RED.nodes.registerType('opcua-method', OpcuaMethod);
};

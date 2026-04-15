'use strict';
// WP-C-3 (M2): opcua-read — Smart-batching read worker node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching

const { normalizeDataValue } = require('../../../lib/client/udt-deserializer');

const STATUS_MAP = {
  DISCONNECTED:    { fill: 'red',    shape: 'ring', text: 'Disconnected' },
  CONNECTING:      { fill: 'yellow', shape: 'ring', text: 'Connecting...' },
  CONNECTED:       { fill: 'yellow', shape: 'dot',  text: 'Connected' },
  SESSION_ACTIVE:  { fill: 'green',  shape: 'dot',  text: 'Ready' },
  CONNECTION_LOST: { fill: 'red',    shape: 'dot',  text: 'Connection lost' },
  RECONNECTING:    { fill: 'yellow', shape: 'ring', text: 'Reconnecting...' }
};

module.exports = function (RED) {
  function OpcuaRead(config) {
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
    // Show initial state
    onStateChange(node.configNode.fsm.state);

    // ── Input handler: submit read to BatchScheduler ─────────────────────
    node.on('input', async (msg, send, done) => {
      const nodeId = config.nodeId || msg.topic;
      if (!nodeId) {
        node.error('No NodeId configured and no msg.topic provided', msg);
        return done();
      }

      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active — dropping read request');
        return done();
      }

      if (!node.configNode.scheduler) {
        node.warn('BatchScheduler not available — dropping read request');
        return done();
      }

      try {
        const dataValue = await node.configNode.scheduler.scheduleRead(nodeId);
        const normalized = normalizeDataValue(dataValue, nodeId);
        // Merge into incoming msg to preserve msg._msgid and other properties
        msg.payload = normalized.payload;
        msg.opcua   = normalized.opcua;
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

  RED.nodes.registerType('opcua-read', OpcuaRead);
};

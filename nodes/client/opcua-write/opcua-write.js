'use strict';
// WP-C-3 (M2): opcua-write — Smart-batching write worker node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching

const { DataType, Variant } = require('node-opcua');

const DATA_TYPE_MAP = {
  Boolean:  DataType.Boolean,
  SByte:    DataType.SByte,
  Byte:     DataType.Byte,
  Int16:    DataType.Int16,
  UInt16:   DataType.UInt16,
  Int32:    DataType.Int32,
  UInt32:   DataType.UInt32,
  Int64:    DataType.Int64,
  UInt64:   DataType.UInt64,
  Float:    DataType.Float,
  Double:   DataType.Double,
  String:   DataType.String,
  DateTime: DataType.DateTime
};

const STATUS_MAP = {
  DISCONNECTED:    { fill: 'red',    shape: 'ring', text: 'Disconnected' },
  CONNECTING:      { fill: 'yellow', shape: 'ring', text: 'Connecting...' },
  CONNECTED:       { fill: 'yellow', shape: 'dot',  text: 'Connected' },
  SESSION_ACTIVE:  { fill: 'green',  shape: 'dot',  text: 'Ready' },
  CONNECTION_LOST: { fill: 'red',    shape: 'dot',  text: 'Connection lost' },
  RECONNECTING:    { fill: 'yellow', shape: 'ring', text: 'Reconnecting...' }
};

module.exports = function (RED) {
  function OpcuaWrite(config) {
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

    // ── Input handler: submit write to BatchScheduler ────────────────────
    node.on('input', async (msg, send, done) => {
      const nodeId = config.nodeId || msg.topic;
      const value  = msg.payload;

      if (!nodeId) {
        node.error('No NodeId configured and no msg.topic provided', msg);
        return done();
      }

      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active — dropping write request');
        return done();
      }

      if (!node.configNode.scheduler) {
        node.warn('BatchScheduler not available — dropping write request');
        return done();
      }

      try {
        // Build the write value — if msg.payload is already a Variant, use it directly
        let writeValue;
        if (value && typeof value === 'object' && value.dataType !== undefined && value.value !== undefined) {
          // Already a Variant-like object
          writeValue = { value: value };
        } else {
          // Wrap in a Variant using configured or inferred datatype
          const dtName = config.datatype || msg.datatype || 'Double';
          const dt = DATA_TYPE_MAP[dtName] || DataType.Variant;
          writeValue = {
            value: new Variant({ dataType: dt, value: value })
          };
        }

        const statusCode = await node.configNode.scheduler.scheduleWrite(nodeId, writeValue);
        msg.opcua = {
          nodeId,
          statusCode: statusCode?.name || (statusCode?.value === 0 ? 'Good' : String(statusCode))
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

  RED.nodes.registerType('opcua-write', OpcuaWrite);
};

'use strict';
// WP-C-3: opcua-read — Smart-batching read worker node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching

module.exports = function (RED) {
  function OpcuaRead(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode = RED.nodes.getNode(config.connection);
    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    node.configNode.fsm.on('stateChange', (state) => {
      const statusMap = {
        DISCONNECTED:    { fill: 'red',    shape: 'ring', text: 'Disconnected' },
        CONNECTING:      { fill: 'yellow', shape: 'ring', text: 'Connecting...' },
        SESSION_ACTIVE:  { fill: 'green',  shape: 'dot',  text: 'Ready' },
        CONNECTION_LOST: { fill: 'red',    shape: 'dot',  text: 'Connection lost' },
        RECONNECTING:    { fill: 'yellow', shape: 'ring', text: 'Reconnecting...' }
      };
      node.status(statusMap[state] || { fill: 'grey', shape: 'ring', text: state });
    });

    node.on('input', async (msg, send, done) => {
      const nodeId = config.nodeId || msg.topic;
      if (!nodeId) {
        node.error('No NodeId configured', msg);
        return done();
      }

      if (node.configNode.fsm.state !== 'SESSION_ACTIVE') {
        node.warn('Session not active — dropping read request');
        return done();
      }

      // TODO WP-C-3: Submit to BatchScheduler instead of direct read
      // node.configNode.scheduler.scheduleRead(nodeId)
      //   .then(dataValue => { send(normalizeDataValue(dataValue, nodeId)); done(); })
      //   .catch(err => done(err));
      done();
    });

    node.on('close', (_removed, done) => done());
  }

  RED.nodes.registerType('opcua-read', OpcuaRead);
};

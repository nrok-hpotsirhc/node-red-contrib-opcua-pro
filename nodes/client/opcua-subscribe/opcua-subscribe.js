'use strict';
// WP-C-3: opcua-subscribe — Push-based DataChange subscription node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#6-subscriptions-monitored-items-und-report-by-exception

module.exports = function (RED) {
  function OpcuaSubscribe(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode   = RED.nodes.getNode(config.connection);
    node.subscription = null;

    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    // TODO WP-C-3: Create subscription on SESSION_ACTIVE, re-subscribe after reconnect (WP-C-2)
    // Parameters: publishingInterval, samplingInterval, deadbandType, deadbandValue, queueSize

    node.on('close', async (_removed, done) => {
      // TODO WP-C-3: Terminate subscription cleanly
      done();
    });
  }

  RED.nodes.registerType('opcua-subscribe', OpcuaSubscribe);
};

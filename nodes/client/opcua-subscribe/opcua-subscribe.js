'use strict';
// WP-C-3 (M2): opcua-subscribe — Push-based DataChange subscription node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#6-subscriptions-monitored-items-und-report-by-exception

const {
  ClientSubscription,
  ClientMonitoredItem,
  AttributeIds,
  TimestampsToReturn
} = require('node-opcua');
const { normalizeDataValue } = require('../../../lib/client/udt-deserializer');
const { STATUS_MAP } = require('../../../lib/client/node-status');

module.exports = function (RED) {
  function OpcuaSubscribe(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode   = RED.nodes.getNode(config.connection);
    node.subscription = null;
    node.monitoredItem = null;

    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    // ── Status propagation from FSM ───────────────────────────────────────
    function onStateChange(state) {
      if (state === 'SESSION_ACTIVE') {
        // Auto-subscribe when session becomes active — setupSubscription sets its own status
        setupSubscription().catch(err => node.error(`Subscription setup failed: ${err.message}`));
        return;
      }
      node.status(STATUS_MAP[state] || { fill: 'grey', shape: 'ring', text: state });
    }
    node.configNode.fsm.on('stateChange', onStateChange);

    // ── Also handle subscription reactivation after reconnect ────────────
    function onSubsReactivated({ expired }) {
      if (expired && expired.includes(node.subscription)) {
        // Our subscription expired during reconnect — recreate it
        node.subscription = null;
        node.monitoredItem = null;
        if (node.configNode.fsm.state === 'SESSION_ACTIVE') {
          setupSubscription().catch(err => node.error(`Subscription recreation failed: ${err.message}`));
        }
      }
    }
    node.configNode.on('subscriptionsReactivated', onSubsReactivated);

    // ── Subscription setup ───────────────────────────────────────────────
    async function setupSubscription() {
      const nodeId = config.nodeId;
      if (!nodeId) {
        node.status({ fill: 'red', shape: 'ring', text: 'No NodeId' });
        return;
      }

      if (!node.configNode.session) {
        node.status(STATUS_MAP.SESSION_ACTIVE);
        return;
      }

      // Don't create duplicates
      if (node.subscription) {
        node.status({ fill: 'green', shape: 'dot', text: 'Subscribed' });
        return;
      }

      try {
        const subscription = ClientSubscription.create(node.configNode.session, {
          requestedPublishingInterval: parseInt(config.publishingInterval, 10) || 500,
          requestedMaxKeepAliveCount:  10,
          requestedLifetimeCount:      60,
          maxNotificationsPerPublish:  100,
          publishingEnabled:           true,
          priority:                    1
        });

        node.subscription = subscription;

        // Register with config node for reactivation on reconnect
        node.configNode.registerSubscription(subscription);

        subscription.on('started', () => {
          node.status({ fill: 'green', shape: 'dot', text: 'Subscribed' });
        });

        subscription.on('terminated', () => {
          node.status({ fill: 'red', shape: 'ring', text: 'Terminated' });
        });

        const monitoredItem = ClientMonitoredItem.create(
          subscription,
          {
            nodeId:      nodeId,
            attributeId: AttributeIds.Value
          },
          {
            samplingInterval: parseInt(config.samplingInterval, 10) || 100,
            discardOldest:    true,
            queueSize:        parseInt(config.queueSize, 10) || 10
          },
          TimestampsToReturn.Both
        );

        node.monitoredItem = monitoredItem;

        monitoredItem.on('changed', (dataValue) => {
          const normalized = normalizeDataValue(dataValue, nodeId);
          node.send({
            payload: normalized.payload,
            opcua:   normalized.opcua,
            topic:   nodeId
          });
        });

      } catch (err) {
        node.error(`Subscription setup failed: ${err.message}`);
        node.status({ fill: 'red', shape: 'ring', text: 'Sub failed' });
      }
    }

    // If session is already active on deploy, subscribe immediately
    if (node.configNode.fsm.state === 'SESSION_ACTIVE') {
      setupSubscription().catch(err => node.error(`Subscription setup failed: ${err.message}`));
    } else {
      onStateChange(node.configNode.fsm.state);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    node.on('close', async (_removed, done) => {
      node.configNode.fsm.removeListener('stateChange', onStateChange);
      node.configNode.removeListener('subscriptionsReactivated', onSubsReactivated);

      if (node.subscription) {
        node.configNode.unregisterSubscription(node.subscription);
        try {
          await node.subscription.terminate();
        } catch (_) { /* ignore cleanup errors */ }
        node.subscription = null;
        node.monitoredItem = null;
      }
      done();
    });
  }

  RED.nodes.registerType('opcua-subscribe', OpcuaSubscribe);
};

'use strict';
// WP-C-3 (M2): opcua-subscribe — Push-based DataChange subscription node
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#6-subscriptions-monitored-items-und-report-by-exception

const {
  ClientSubscription,
  ClientMonitoredItem,
  AttributeIds,
  TimestampsToReturn,
  DataChangeFilter,
  DataChangeTrigger,
  DeadbandType
} = require('node-opcua');
const { randomUUID } = require('crypto');
const { normalizeDataValue } = require('../../../lib/client/udt-deserializer');
const { STATUS_MAP } = require('../../../lib/client/node-status');

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildMonitoringParameters(config) {
  const parameters = {
    samplingInterval: toPositiveInt(config.samplingInterval, 100),
    discardOldest:    true,
    queueSize:        toPositiveInt(config.queueSize, 10)
  };

  const deadbandType = config.deadbandType || 'None';
  if (deadbandType !== 'None' && DeadbandType[deadbandType] !== undefined) {
    parameters.filter = new DataChangeFilter({
      trigger:       DataChangeTrigger.StatusValue,
      deadbandType:  DeadbandType[deadbandType],
      deadbandValue: toNonNegativeNumber(config.deadbandValue, 0)
    });
  }

  return parameters;
}

module.exports = function (RED) {
  function OpcuaSubscribe(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.configNode   = RED.nodes.getNode(config.connection);
    node.subscription = null;
    node.monitoredItem = null;
    let settingUp = false;
    let retryTimer = null;
    let closing = false;

    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config node' });
      return;
    }

    // ── Status propagation from FSM ───────────────────────────────────────
    function onStateChange(state) {
      if (state === 'SESSION_ACTIVE') {
        // Auto-subscribe when session becomes active — setupSubscription sets its own status
        attemptSubscriptionSetup('Subscription setup failed');
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
          attemptSubscriptionSetup('Subscription recreation failed');
        }
      }
    }
    node.configNode.on('subscriptionsReactivated', onSubsReactivated);

    // ── Subscription setup ───────────────────────────────────────────────
    function clearRetryTimer() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function scheduleSubscriptionRetry(message) {
      node.error(message);
      clearRetryTimer();
      if (closing) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (closing || node.subscription || node.configNode.fsm.state !== 'SESSION_ACTIVE') {
          return;
        }
        attemptSubscriptionSetup('Subscription retry failed');
      }, 2000); // Retry after 2 seconds to avoid tight reconnect/setup loops.
      if (typeof retryTimer.unref === 'function') retryTimer.unref();
    }

    function attemptSubscriptionSetup(errorPrefix) {
      setupSubscription().catch(err => {
        scheduleSubscriptionRetry(`${errorPrefix}: ${err.message}`);
      });
    }

    async function setupSubscription() {
      const nodeId = config.nodeId;
      if (!nodeId) {
        node.status({ fill: 'red', shape: 'ring', text: 'No NodeId' });
        return;
      }

      if (!node.configNode.session) {
        node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for session' });
        return;
      }

      // Guard against concurrent setup (race from rapid FSM transitions)
      if (settingUp || node.subscription) {
        if (node.subscription) {
          node.status({ fill: 'green', shape: 'dot', text: 'Subscribed' });
        }
        return;
      }
      settingUp = true;
      let subscription = null;

      try {
        subscription = ClientSubscription.create(node.configNode.session, {
          requestedPublishingInterval: toPositiveInt(config.publishingInterval, 500),
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
          buildMonitoringParameters(config),
          TimestampsToReturn.Both
        );

        node.monitoredItem = monitoredItem;

        monitoredItem.on('changed', (dataValue) => {
          const normalized = normalizeDataValue(dataValue, nodeId);
          node.send({
            _msgid:  randomUUID(),
            payload: normalized.payload,
            opcua:   normalized.opcua,
            topic:   nodeId
          });
        });

      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'Sub failed' });
        if (subscription) {
          node.configNode.unregisterSubscription(subscription);
          try { await subscription.terminate(); } catch (_) { /* ignore cleanup errors */ }
        }
        if (node.subscription === subscription) {
          node.subscription = null;
          node.monitoredItem = null;
        }
        throw err;
      } finally {
        settingUp = false;
      }
    }

    // If session is already active on deploy, subscribe immediately
    if (node.configNode.fsm.state === 'SESSION_ACTIVE') {
      attemptSubscriptionSetup('Subscription setup failed');
    } else {
      onStateChange(node.configNode.fsm.state);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    node.on('close', async (_removed, done) => {
      closing = true;
      clearRetryTimer();
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

module.exports._internals = { buildMonitoringParameters };

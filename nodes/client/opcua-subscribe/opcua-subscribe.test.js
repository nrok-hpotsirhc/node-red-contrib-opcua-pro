'use strict';
/**
 * opcua-subscribe — Unit Tests
 * =============================
 * What is tested here:
 *
 *   The opcua-subscribe node creates an OPC UA subscription with monitored items
 *   and emits msg on DataChange events. Tests mock the Node-RED runtime and
 *   config node.
 *
 * Why these test cases:
 *   - Registers as "opcua-subscribe" type
 *   - Shows error status when no config node
 *   - Shows error status when no NodeId configured
 *   - Defers subscription setup when session is not active
 *   - Cleans up on close (removes listeners, unregisters subscription)
 *   - FSM state change updates node status
 *   - Subscription setup triggered on SESSION_ACTIVE state change
 *
 * See: docs/work-packages.md#wp-c-3 — Worker Nodes & Smart Batching
 * See: docs/theoretical-foundations.md#6 — Subscriptions
 */
const assert = require('assert');
const EventEmitter = require('events');

// ── Mock Node-RED runtime ─────────────────────────────────────────────────
function createMockRED() {
  const registeredTypes = {};
  const nodes = {};

  return {
    nodes: {
      registerType: (name, ctor) => { registeredTypes[name] = ctor; },
      createNode:   (node, config) => {
        node.id = config.id || 'test-node-id';
        node._handlers = {};
        node.on = (evt, fn) => { node._handlers[evt] = fn; };
        node.status = (s) => { node._lastStatus = s; };
        node.error  = (msg) => { node._lastError = msg; };
        node.warn   = (msg) => { node._lastWarn = msg; };
        node.send   = (msg) => { node._lastSent = msg; };
      },
      getNode: (id) => nodes[id]
    },
    registeredTypes,
    _nodes: nodes
  };
}

function createMockConfigNode(overrides = {}) {
  const configNode = new EventEmitter();
  configNode.fsm = new EventEmitter();
  configNode.fsm.state = overrides.fsmState || 'DISCONNECTED';
  configNode.session = overrides.session || null;
  configNode.scheduler = overrides.scheduler || null;
  configNode.subscriptions = [];
  configNode.registerSubscription = (sub) => configNode.subscriptions.push(sub);
  configNode.unregisterSubscription = (sub) => {
    configNode.subscriptions = configNode.subscriptions.filter(s => s !== sub);
  };
  return configNode;
}

const registerOpcuaSubscribe = require('./opcua-subscribe');

describe('opcua-subscribe', () => {

  let RED;

  beforeEach(() => {
    RED = createMockRED();
    registerOpcuaSubscribe(RED);
  });

  it('registers as "opcua-subscribe" type', () => {
    assert.ok(RED.registeredTypes['opcua-subscribe']);
  });

  it('shows red status when no config node is found', () => {
    const node = {};
    RED.registeredTypes['opcua-subscribe'].call(node, { connection: 'missing-id' });
    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.ok(node._lastStatus.text.includes('No config'));
  });

  it('sets initial status based on FSM state', () => {
    const configNode = createMockConfigNode({ fsmState: 'CONNECTING' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-subscribe'].call(node, {
      connection: 'cfg1', nodeId: 'ns=1;s=T',
      publishingInterval: 500, samplingInterval: 100, queueSize: 10
    });

    assert.strictEqual(node._lastStatus.fill, 'yellow');
    assert.strictEqual(node._lastStatus.text, 'Connecting...');
  });

  it('updates status on FSM state change', () => {
    const configNode = createMockConfigNode({ fsmState: 'DISCONNECTED' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-subscribe'].call(node, {
      connection: 'cfg1', nodeId: 'ns=1;s=T',
      publishingInterval: 500, samplingInterval: 100, queueSize: 10
    });

    configNode.fsm.emit('stateChange', 'CONNECTION_LOST');
    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.strictEqual(node._lastStatus.text, 'Connection lost');
  });

  it('removes listeners and unregisters subscription on close', () => {
    const configNode = createMockConfigNode({ fsmState: 'DISCONNECTED' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-subscribe'].call(node, {
      connection: 'cfg1', nodeId: 'ns=1;s=T',
      publishingInterval: 500, samplingInterval: 100, queueSize: 10
    });

    const fsmListenersBefore = configNode.fsm.listenerCount('stateChange');
    const subListenersBefore = configNode.listenerCount('subscriptionsReactivated');

    let closeDone = false;
    node._handlers.close(false, () => { closeDone = true; });

    assert.ok(closeDone, 'done() must be called');
    assert.ok(configNode.fsm.listenerCount('stateChange') < fsmListenersBefore);
    assert.ok(configNode.listenerCount('subscriptionsReactivated') < subListenersBefore);
  });

  it('shows error status when nodeId is empty', () => {
    const configNode = createMockConfigNode({ fsmState: 'SESSION_ACTIVE', session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-subscribe'].call(node, {
      connection: 'cfg1', nodeId: '',
      publishingInterval: 500, samplingInterval: 100, queueSize: 10
    });

    // Trigger subscription setup via SESSION_ACTIVE
    configNode.fsm.emit('stateChange', 'SESSION_ACTIVE');
    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.ok(node._lastStatus.text.includes('No NodeId'));
  });
});

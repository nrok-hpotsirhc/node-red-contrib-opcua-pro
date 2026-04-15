'use strict';
/**
 * opcua-read — Unit Tests
 * ========================
 * What is tested here:
 *
 *   The opcua-read node reads OPC UA variables via the BatchScheduler in the
 *   config node. These tests mock the Node-RED runtime and the config node to
 *   verify behavior in isolation.
 *
 * Why these test cases:
 *   - Registers as "opcua-read" type
 *   - Shows error status when no config node
 *   - Drops request when no NodeId configured and no msg.topic
 *   - Drops request when session not active
 *   - Drops request when scheduler not available
 *   - Successful read → msg.payload + msg.opcua
 *   - Uses msg.topic as nodeId when config.nodeId is empty
 *   - Scheduler error is forwarded via done(err)
 *   - FSM state change updates node status
 *   - Cleans up FSM listener on close
 *
 * See: docs/work-packages.md#wp-c-3 — Worker Nodes & Smart Batching
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
  const fsm = new EventEmitter();
  fsm.state = overrides.fsmState || 'SESSION_ACTIVE';

  return {
    fsm,
    session:   overrides.session || {},
    scheduler: overrides.scheduler || null,
    ...overrides
  };
}

// ── Load module ─────────────────────────────────────────────────────────────
const registerOpcuaRead = require('./opcua-read');

describe('opcua-read', () => {

  let RED;

  beforeEach(() => {
    RED = createMockRED();
    registerOpcuaRead(RED);
  });

  it('registers as "opcua-read" type', () => {
    assert.ok(RED.registeredTypes['opcua-read'], 'Must register opcua-read type');
  });

  it('shows red status when no config node is found', () => {
    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'missing-id' });
    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.ok(node._lastStatus.text.includes('No config'));
  });

  it('sends error when input has no NodeId configured and no msg.topic', () => {
    const configNode = createMockConfigNode({ scheduler: { scheduleRead: async () => ({}) } });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: '' });

    let doneCalled = false;
    const msg = {};
    node._handlers.input(msg, node.send, () => { doneCalled = true; });

    // Should call error
    assert.ok(node._lastError);
    assert.ok(doneCalled);
  });

  it('drops request when session is not active', () => {
    const configNode = createMockConfigNode({ fsmState: 'CONNECTING' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('drops request when scheduler is not available', () => {
    const configNode = createMockConfigNode({ scheduler: null });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('successful read sends msg with payload and opcua metadata', async () => {
    const { Variant, DataType, StatusCodes } = require('node-opcua');
    const mockDataValue = {
      value:           new Variant({ dataType: DataType.Double, value: 42.0 }),
      statusCode:      { name: 'Good' },
      sourceTimestamp: new Date(),
      serverTimestamp: new Date()
    };

    const configNode = createMockConfigNode({
      scheduler: { scheduleRead: async () => mockDataValue }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=Temp' });

    let sentMsg = null;
    let doneErr = undefined;
    const sendFn = (m) => { sentMsg = m; };

    await node._handlers.input({ _msgid: '123' }, sendFn, (err) => { doneErr = err; });

    assert.strictEqual(sentMsg.payload, 42.0, 'payload must be the deserialized value');
    assert.strictEqual(sentMsg.opcua.statusCode, 'Good');
    assert.strictEqual(sentMsg.opcua.nodeId, 'ns=1;s=Temp');
    assert.strictEqual(sentMsg._msgid, '123', 'msg._msgid must be preserved');
    assert.strictEqual(doneErr, undefined, 'done must not receive an error');
  });

  it('uses msg.topic as nodeId when config.nodeId is empty', async () => {
    let receivedNodeId;
    const mockDataValue = {
      value:      { dataType: 11, value: 10.0 },
      statusCode: { name: 'Good' }
    };

    const configNode = createMockConfigNode({
      scheduler: { scheduleRead: async (nid) => { receivedNodeId = nid; return mockDataValue; } }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: '' });

    await node._handlers.input({ topic: 'ns=1;s=FromTopic' }, () => {}, () => {});
    assert.strictEqual(receivedNodeId, 'ns=1;s=FromTopic');
  });

  it('forwards scheduler error via done(err)', async () => {
    const configNode = createMockConfigNode({
      scheduler: { scheduleRead: async () => { throw new Error('ReadFailed'); } }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    let doneErr;
    await node._handlers.input({}, () => {}, (err) => { doneErr = err; });
    assert.ok(doneErr);
    assert.ok(doneErr.message.includes('ReadFailed'));
  });

  it('updates node status on FSM state change', () => {
    const configNode = createMockConfigNode({ fsmState: 'DISCONNECTED' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    configNode.fsm.emit('stateChange', 'SESSION_ACTIVE');
    assert.strictEqual(node._lastStatus.fill, 'green');
    assert.strictEqual(node._lastStatus.text, 'Ready');

    configNode.fsm.emit('stateChange', 'CONNECTION_LOST');
    assert.strictEqual(node._lastStatus.fill, 'red');
  });

  it('removes FSM listener on close', () => {
    const configNode = createMockConfigNode();
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-read'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    const listenersBefore = configNode.fsm.listenerCount('stateChange');
    node._handlers.close(false, () => {});
    const listenersAfter = configNode.fsm.listenerCount('stateChange');
    assert.ok(listenersAfter < listenersBefore, 'FSM listener must be removed on close');
  });
});

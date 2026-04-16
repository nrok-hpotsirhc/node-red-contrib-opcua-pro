'use strict';
/**
 * opcua-method — Unit Tests (Client-side Method Call)
 * ====================================================
 * What is tested here:
 *
 *   The opcua-method node calls OPC UA methods on the server via session.call().
 *   These tests mock the Node-RED runtime and the config node to verify behavior.
 *
 * Why these test cases:
 *   - Registers as "opcua-method" type
 *   - Shows error status when no config node
 *   - Drops request when no objectId provided
 *   - Drops request when no methodId provided
 *   - Drops request when session not active
 *   - Drops request when session not available
 *   - Successful method call → msg.payload + msg.opcua
 *   - Single output argument returns unwrapped value
 *   - Multiple output arguments return array
 *   - Uses msg.objectId / msg.methodId as overrides
 *   - Non-array payload sends empty inputArguments
 *   - session.call() error is forwarded via done(err)
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
        node.id = config.id || 'test-method-id'; // TEST DATA
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
    session: overrides.session || null,
    ...overrides
  };
}

// ── Load module ─────────────────────────────────────────────────────────────
const registerOpcuaMethod = require('./opcua-method');

describe('opcua-method (client)', () => {

  let RED;

  beforeEach(() => {
    RED = createMockRED();
    registerOpcuaMethod(RED);
  });

  it('registers as "opcua-method" type', () => {
    assert.ok(RED.registeredTypes['opcua-method'], 'Must register opcua-method type');
  });

  it('shows red status when no config node is found', () => {
    const node = {};
    RED.registeredTypes['opcua-method'].call(node, { connection: 'missing-id' }); // TEST DATA
    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.ok(node._lastStatus.text.includes('No config'));
  });

  it('sends error when input has no objectId configured and no msg.objectId', () => {
    const configNode = createMockConfigNode({ session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: '', methodId: 'ns=1;s=DoIt' // TEST DATA
    });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });

    assert.ok(node._lastError);
    assert.ok(doneCalled);
  });

  it('sends error when input has no methodId configured and no msg.methodId', () => {
    const configNode = createMockConfigNode({ session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=Obj', methodId: '' // TEST DATA
    });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });

    assert.ok(node._lastError);
    assert.ok(doneCalled);
  });

  it('drops request when session is not active', () => {
    const configNode = createMockConfigNode({ fsmState: 'CONNECTING', session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=Obj', methodId: 'ns=1;s=M' // TEST DATA
    });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('drops request when session is null', () => {
    const configNode = createMockConfigNode({ session: null });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=Obj', methodId: 'ns=1;s=M' // TEST DATA
    });

    let doneCalled = false;
    node._handlers.input({}, node.send, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('successful method call sends msg with single output argument unwrapped', async () => {
    const mockCallResult = {
      statusCode: { name: 'Good' },
      outputArguments: [{ value: 'result-value' }] // TEST DATA
    };
    const configNode = createMockConfigNode({
      session: { call: async () => mockCallResult }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=Obj', methodId: 'ns=1;s=Meth' // TEST DATA
    });

    let sentMsg = null;
    let doneErr;
    const sendFn = (m) => { sentMsg = m; };

    await node._handlers.input(
      { _msgid: 'abc', payload: [{ dataType: 11, value: 42 }] }, // TEST DATA
      sendFn,
      (err) => { doneErr = err; }
    );

    assert.strictEqual(sentMsg.payload, 'result-value');
    assert.strictEqual(sentMsg.opcua.statusCode, 'Good');
    assert.strictEqual(sentMsg.opcua.objectId, 'ns=1;s=Obj');
    assert.strictEqual(sentMsg.opcua.methodId, 'ns=1;s=Meth');
    assert.strictEqual(sentMsg._msgid, 'abc', 'msg._msgid must be preserved');
    assert.strictEqual(doneErr, undefined);
  });

  it('multiple output arguments are returned as array', async () => {
    const mockCallResult = {
      statusCode: { name: 'Good' },
      outputArguments: [{ value: 'a' }, { value: 'b' }] // TEST DATA
    };
    const configNode = createMockConfigNode({
      session: { call: async () => mockCallResult }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    let sentMsg = null;
    await node._handlers.input(
      { payload: [] },
      (m) => { sentMsg = m; },
      () => {}
    );

    assert.deepStrictEqual(sentMsg.payload, ['a', 'b']);
  });

  it('empty output arguments returns empty array', async () => {
    const mockCallResult = {
      statusCode: { name: 'Good' },
      outputArguments: []
    };
    const configNode = createMockConfigNode({
      session: { call: async () => mockCallResult }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    let sentMsg = null;
    await node._handlers.input(
      { payload: [] },
      (m) => { sentMsg = m; },
      () => {}
    );

    assert.deepStrictEqual(sentMsg.payload, []);
  });

  it('uses msg.objectId and msg.methodId as overrides', async () => {
    let calledWith;
    const mockCallResult = {
      statusCode: { name: 'Good' },
      outputArguments: [{ value: 'ok' }] // TEST DATA
    };
    const configNode = createMockConfigNode({
      session: { call: async (args) => { calledWith = args; return mockCallResult; } }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: '', methodId: '' // TEST DATA — empty config
    });

    await node._handlers.input(
      { objectId: 'ns=2;s=DynObj', methodId: 'ns=2;s=DynMeth', payload: [] }, // TEST DATA
      () => {},
      () => {}
    );

    assert.strictEqual(calledWith.objectId, 'ns=2;s=DynObj');
    assert.strictEqual(calledWith.methodId, 'ns=2;s=DynMeth');
  });

  it('non-array payload sends empty inputArguments', async () => {
    let calledWith;
    const configNode = createMockConfigNode({
      session: { call: async (args) => {
        calledWith = args;
        return { statusCode: { name: 'Good' }, outputArguments: [] };
      }}
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    await node._handlers.input(
      { payload: 'not-an-array' }, // TEST DATA
      () => {},
      () => {}
    );

    assert.deepStrictEqual(calledWith.inputArguments, []);
  });

  it('forwards session.call() error via done(err)', async () => {
    const configNode = createMockConfigNode({
      session: { call: async () => { throw new Error('CallFailed'); } } // TEST DATA
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    let doneErr;
    await node._handlers.input(
      { payload: [] },
      () => {},
      (err) => { doneErr = err; }
    );
    assert.ok(doneErr);
    assert.ok(doneErr.message.includes('CallFailed'));
  });

  it('updates node status on FSM state change', () => {
    const configNode = createMockConfigNode({ fsmState: 'DISCONNECTED', session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    configNode.fsm.emit('stateChange', 'SESSION_ACTIVE');
    assert.strictEqual(node._lastStatus.fill, 'green');
    assert.strictEqual(node._lastStatus.text, 'Ready');

    configNode.fsm.emit('stateChange', 'CONNECTION_LOST');
    assert.strictEqual(node._lastStatus.fill, 'red');
  });

  it('removes FSM listener on close', () => {
    const configNode = createMockConfigNode({ session: {} });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-method'].call(node, {
      connection: 'cfg1', objectId: 'ns=1;s=O', methodId: 'ns=1;s=M' // TEST DATA
    });

    const listenersBefore = configNode.fsm.listenerCount('stateChange');
    node._handlers.close(false, () => {});
    const listenersAfter = configNode.fsm.listenerCount('stateChange');
    assert.ok(listenersAfter < listenersBefore, 'FSM listener must be removed on close');
  });
});

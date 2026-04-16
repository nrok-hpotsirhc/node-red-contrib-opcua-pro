'use strict';
/**
 * opcua-write — Unit Tests
 * =========================
 * What is tested here:
 *
 *   The opcua-write node writes OPC UA variables via the BatchScheduler in the
 *   config node. Tests mock the Node-RED runtime and config node.
 *
 * Why these test cases:
 *   - Registers as "opcua-write" type
 *   - Shows error status when no config node
 *   - Sends error when no NodeId configured and no msg.topic
 *   - Drops request when session not active
 *   - Drops request when scheduler not available
 *   - Successful write → msg.opcua with statusCode
 *   - Uses msg.topic as nodeId when config.nodeId is empty
 *   - Scheduler error is forwarded via done(err)
 *   - Wraps payload in Variant using configured datatype
 *   - Passes through Variant-like objects directly
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

const registerOpcuaWrite = require('./opcua-write');

describe('opcua-write', () => {

  let RED;

  beforeEach(() => {
    RED = createMockRED();
    registerOpcuaWrite(RED);
  });

  it('registers as "opcua-write" type', () => {
    assert.ok(RED.registeredTypes['opcua-write']);
  });

  it('shows red status when no config node is found', () => {
    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'missing-id' });
    assert.strictEqual(node._lastStatus.fill, 'red');
  });

  it('sends error when no NodeId configured and no msg.topic', () => {
    const configNode = createMockConfigNode({ scheduler: { scheduleWrite: async () => ({}) } });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: '' });

    let doneCalled = false;
    node._handlers.input({ payload: 42 }, () => {}, () => { doneCalled = true; });
    assert.ok(node._lastError);
    assert.ok(doneCalled);
  });

  it('drops request when session not active', () => {
    const configNode = createMockConfigNode({ fsmState: 'CONNECTING' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    let doneCalled = false;
    node._handlers.input({ payload: 42 }, () => {}, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('drops request when scheduler not available', () => {
    const configNode = createMockConfigNode({ scheduler: null });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    let doneCalled = false;
    node._handlers.input({ payload: 42 }, () => {}, () => { doneCalled = true; });
    assert.ok(node._lastWarn);
    assert.ok(doneCalled);
  });

  it('successful write sends msg with opcua.statusCode', async () => {
    let writtenNodeId, writtenValue;
    const configNode = createMockConfigNode({
      scheduler: {
        scheduleWrite: async (nid, val) => {
          writtenNodeId = nid;
          writtenValue = val;
          return { name: 'Good', value: 0 };
        }
      }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=Temp', datatype: 'Double' });

    let sentMsg = null;
    let doneErr;
    await node._handlers.input(
      { payload: 99.0, _msgid: '456' },
      (m) => { sentMsg = m; },
      (err) => { doneErr = err; }
    );

    assert.strictEqual(sentMsg.opcua.nodeId, 'ns=1;s=Temp');
    assert.strictEqual(sentMsg.opcua.statusCode, 'Good');
    assert.strictEqual(sentMsg._msgid, '456', 'msg._msgid must be preserved');
    assert.strictEqual(doneErr, undefined);
    assert.strictEqual(writtenNodeId, 'ns=1;s=Temp');
    assert.ok(writtenValue.value, 'value must be wrapped in a Variant-like object');
  });

  it('uses msg.topic as nodeId when config.nodeId is empty', async () => {
    let receivedNodeId;
    const configNode = createMockConfigNode({
      scheduler: { scheduleWrite: async (nid) => { receivedNodeId = nid; return { name: 'Good', value: 0 }; } }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: '', datatype: 'Double' });

    await node._handlers.input({ topic: 'ns=1;s=FromTopic', payload: 1 }, () => {}, () => {});
    assert.strictEqual(receivedNodeId, 'ns=1;s=FromTopic');
  });

  it('forwards scheduler error via done(err)', async () => {
    const configNode = createMockConfigNode({
      scheduler: { scheduleWrite: async () => { throw new Error('WriteFailed'); } }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T', datatype: 'Double' });

    let doneErr;
    await node._handlers.input({ payload: 42 }, () => {}, (err) => { doneErr = err; });
    assert.ok(doneErr);
    assert.ok(doneErr.message.includes('WriteFailed'));
  });

  it('updates node status on FSM state change', () => {
    const configNode = createMockConfigNode({ fsmState: 'DISCONNECTED' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    configNode.fsm.emit('stateChange', 'SESSION_ACTIVE');
    assert.strictEqual(node._lastStatus.fill, 'green');

    configNode.fsm.emit('stateChange', 'RECONNECTING');
    assert.strictEqual(node._lastStatus.fill, 'yellow');
  });

  it('passes Variant-like payload directly without re-wrapping', async () => {
    let capturedValue;
    const configNode = createMockConfigNode({
      scheduler: {
        scheduleWrite: async (nid, val) => {
          capturedValue = val;
          return { name: 'Good', value: 0 };
        }
      }
    });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T', datatype: 'Double' });

    // Send a Variant-like object (has dataType and value fields)
    const variantPayload = { dataType: 11, value: 42.0 }; // TEST DATA — Variant-like object
    await node._handlers.input(
      { payload: variantPayload },
      () => {},
      () => {}
    );

    // The value should be passed wrapped as { value: variantPayload }
    assert.deepStrictEqual(capturedValue.value, variantPayload);
  });

  it('removes FSM listener on close', () => {
    const configNode = createMockConfigNode({ fsmState: 'SESSION_ACTIVE' });
    RED._nodes['cfg1'] = configNode;

    const node = {};
    RED.registeredTypes['opcua-write'].call(node, { connection: 'cfg1', nodeId: 'ns=1;s=T' });

    const listenersBefore = configNode.fsm.listenerCount('stateChange');

    let closeDone = false;
    node._handlers.close(false, () => { closeDone = true; });

    assert.ok(closeDone);
    assert.ok(configNode.fsm.listenerCount('stateChange') < listenersBefore);
  });
});

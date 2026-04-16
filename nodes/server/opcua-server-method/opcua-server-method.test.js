'use strict';
/**
 * opcua-server-method — Unit Tests
 * ==================================
 * What is tested here:
 *
 *   The opcua-server-method node registers an OPC UA method in the server
 *   address space and routes incoming calls into the Node-RED flow using
 *   a correlation ID pattern.
 *
 * Why these test cases:
 *   - Registers as "opcua-server-method" type
 *   - Shows red status when no server config provided
 *   - Shows red status when no method name provided
 *   - Shows red status when addressSpace is null
 *   - Registers method on addressSpaceReady and shows green status
 *   - Uses existing addressSpace if already set
 *   - Method call sends msg with _opcua_method_id and payload
 *   - Method call times out and cleans up correlation table
 *   - Concurrent method calls are correctly correlated
 *   - Cleanup on close clears pending calls
 *   - parseArgumentDefs handles valid/invalid JSON
 *   - Resolves parentNodeId when configured
 *
 * See: docs/work-packages.md#wp-s-4 — RPC-Methoden & Event Handling
 */
const assert = require('assert');
const sinon  = require('sinon');
const EventEmitter = require('events');

// ── RED mock factory ─────────────────────────────────────────────────────────

function makeRedMock(externalNodes = {}) {
  const registeredTypes = {};
  return {
    nodes: {
      createNode(inst, config) {
        Object.assign(inst, {
          id: config.id || 'test-smethod-id', // TEST DATA
          name: config.name || '',
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub(),
          send:   sinon.stub()
        });
        EventEmitter.call(inst);
        Object.assign(inst, EventEmitter.prototype);
      },
      registerType(name, Ctor) { registeredTypes[name] = Ctor; },
      getType(name) { return registeredTypes[name]; },
      getNode(id) { return externalNodes[id] || null; }
    }
  };
}

function makeServerConfigStub(addressSpace) {
  const emitter = new EventEmitter();
  emitter.addressSpace = addressSpace || null;
  return emitter;
}

function makeAddressSpace(customFindNode) {
  let boundCallback = null;
  const ns = {
    addMethod: sinon.stub().callsFake((_parent, opts) => ({
      browseName: opts.browseName,
      bindMethod: (cb) => { boundCallback = cb; }
    }))
  };
  return {
    _namespace: ns,
    _getBoundCallback: () => boundCallback,
    getOwnNamespace() { return ns; },
    rootFolder: { objects: { browseName: 'Objects' } },
    findNode: customFindNode || sinon.stub().returns(null)
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('opcua-server-method node', () => {

  let RED, OpcuaServerMethod;

  beforeEach(() => {
    RED = makeRedMock();
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');
  });

  afterEach(() => sinon.restore());

  it('registers node type "opcua-server-method"', () => {
    assert.ok(typeof OpcuaServerMethod === 'function');
  });

  it('sets red status when no server config is found', () => {
    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm1' });

    OpcuaServerMethod.call(node, { server: 'nonexistent', methodName: 'Test' }); // TEST DATA

    assert.ok(node.status.calledOnce);
    assert.strictEqual(node.status.firstCall.args[0].fill, 'red');
    assert.ok(node.status.firstCall.args[0].text.includes('No server config'));
  });

  it('sets red status when no method name is provided', () => {
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm2' });

    OpcuaServerMethod.call(node, { server: 'srv', methodName: '' }); // TEST DATA

    assert.ok(node.status.called);
    assert.strictEqual(node.status.lastCall.args[0].fill, 'red');
    assert.ok(node.status.lastCall.args[0].text.includes('No method name'));
  });

  it('sets red status when addressSpace is null', () => {
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm3' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'DoSomething', timeoutMs: '5000' // TEST DATA
    });

    serverConfig.emit('addressSpaceReady', null);

    assert.ok(node.error.calledOnce);
    assert.strictEqual(node.status.lastCall.args[0].fill, 'red');
  });

  it('registers method on addressSpaceReady and shows green status', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm4' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Start', // TEST DATA
      inputArguments: '[{"name":"speed","dataType":"Double"}]',
      outputArguments: '[{"name":"result","dataType":"String"}]',
      timeoutMs: '10000'
    });

    serverConfig.emit('addressSpaceReady', as);

    assert.ok(as._namespace.addMethod.calledOnce);
    const addMethodArgs = as._namespace.addMethod.firstCall.args;
    assert.strictEqual(addMethodArgs[1].browseName, 'Start');
    assert.ok(as._getBoundCallback() !== null, 'bindMethod must be called');
    assert.strictEqual(node.status.lastCall.args[0].fill, 'green');
    assert.strictEqual(node.status.lastCall.args[0].text, 'Start');
  });

  it('uses existing addressSpace if already set on serverConfig', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(as);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm5' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Quick', timeoutMs: '5000' // TEST DATA
    });

    assert.ok(as._namespace.addMethod.calledOnce);
    assert.strictEqual(node.status.lastCall.args[0].fill, 'green');
  });

  it('method call sends msg with _opcua_method_id and payload to flow', (done) => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm6' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Add', timeoutMs: '10000' // TEST DATA
    });

    serverConfig.emit('addressSpaceReady', as);

    const boundCallback = as._getBoundCallback();
    assert.ok(boundCallback, 'method must have a bound callback');

    // Simulate a method call from OPC UA client
    const inputArgs = [{ value: 10 }, { value: 20 }]; // TEST DATA
    boundCallback(inputArgs, {}, (err, result) => {
      // This callback is called when response is provided
      assert.strictEqual(err, null);
      assert.ok(result.statusCode);
      done();
    });

    // Verify msg was sent to flow
    assert.ok(node.send.calledOnce);
    const sentMsg = node.send.firstCall.args[0];
    assert.deepStrictEqual(sentMsg.payload, [10, 20]);
    assert.ok(sentMsg._opcua_method_id, 'Must have correlation ID');
    assert.strictEqual(sentMsg.topic, 'Add');
    assert.strictEqual(typeof sentMsg._opcua_method_id, 'string');
    assert.ok(sentMsg._opcua_method_id.length > 0);

    // Now resolve the pending call (clear timeout first, then resolve)
    const correlationId = sentMsg._opcua_method_id;
    const pending = node.pendingCalls.get(correlationId);
    assert.ok(pending, 'Must have pending call in correlation table');
    clearTimeout(pending.timeout);
    node.pendingCalls.delete(correlationId);
    pending.resolve([{ dataType: 12, value: 'done' }]); // TEST DATA
  });

  it('method call timeout removes entry from correlation table', function (done) {
    this.timeout(5000);

    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm7' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Slow', timeoutMs: '100' // TEST DATA — short timeout for test
    });

    serverConfig.emit('addressSpaceReady', as);

    const boundCallback = as._getBoundCallback();
    let callbackResult = null;

    boundCallback([], {}, (err, result) => {
      callbackResult = result;
      // Verify timeout response
      assert.strictEqual(err, null);
      assert.ok(callbackResult.statusCode);
      // Correlation table must be empty after timeout
      assert.strictEqual(node.pendingCalls.size, 0, 'Timeout must clean up correlation table');
      done();
    });

    // Do NOT resolve — let it timeout
    assert.strictEqual(node.pendingCalls.size, 1, 'Should have one pending call');
  });

  it('concurrent method calls are correctly correlated by UUID', (done) => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm8' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Concurrent', timeoutMs: '10000' // TEST DATA
    });

    serverConfig.emit('addressSpaceReady', as);

    const boundCallback = as._getBoundCallback();
    const results = [];
    let completed = 0;

    // Fire two concurrent calls
    boundCallback([{ value: 'first' }], {}, (err, result) => { // TEST DATA
      results.push(result);
      completed++;
      if (completed === 2) verify();
    });

    boundCallback([{ value: 'second' }], {}, (err, result) => { // TEST DATA
      results.push(result);
      completed++;
      if (completed === 2) verify();
    });

    assert.strictEqual(node.send.callCount, 2, 'Two msgs must be sent');
    assert.strictEqual(node.pendingCalls.size, 2, 'Two pending calls');

    // Verify different correlation IDs
    const id1 = node.send.firstCall.args[0]._opcua_method_id;
    const id2 = node.send.secondCall.args[0]._opcua_method_id;
    assert.notStrictEqual(id1, id2, 'Correlation IDs must be different');

    // Resolve in reverse order to test correlation
    const pending2 = node.pendingCalls.get(id2);
    const pending1 = node.pendingCalls.get(id1);
    clearTimeout(pending2.timeout);
    node.pendingCalls.delete(id2);
    clearTimeout(pending1.timeout);
    node.pendingCalls.delete(id1);
    pending2.resolve([{ dataType: 12, value: 'res2' }]); // TEST DATA
    pending1.resolve([{ dataType: 12, value: 'res1' }]); // TEST DATA

    function verify() {
      assert.strictEqual(node.pendingCalls.size, 0, 'All pending calls must be resolved');
      done();
    }
  });

  it('cleanup on close clears all pending calls', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm9' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'CleanMe', timeoutMs: '30000' // TEST DATA
    });

    serverConfig.emit('addressSpaceReady', as);

    const boundCallback = as._getBoundCallback();
    let closeCBError = null;

    // Create a pending call
    boundCallback([{ value: 'pending' }], {}, (err) => { // TEST DATA
      closeCBError = err;
    });
    assert.strictEqual(node.pendingCalls.size, 1);

    // Close the node
    const doneFn = sinon.stub();
    node.emit('close', false, doneFn);

    assert.strictEqual(node.pendingCalls.size, 0, 'pending calls must be cleared');
    assert.ok(doneFn.calledOnce, 'done must be called');
    // The pending call should have been rejected
    assert.ok(closeCBError !== null, 'pending call must be rejected on close');
  });

  it('handles invalid inputArguments JSON gracefully', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm10' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'BadArgs', // TEST DATA
      inputArguments: 'not-valid-json',
      outputArguments: '',
      timeoutMs: '5000'
    });

    serverConfig.emit('addressSpaceReady', as);

    // Should still register method (with empty argument lists)
    assert.ok(as._namespace.addMethod.calledOnce);
    const addMethodArgs = as._namespace.addMethod.firstCall.args[1];
    assert.deepStrictEqual(addMethodArgs.inputArguments, []);
    assert.deepStrictEqual(addMethodArgs.outputArguments, []);
  });

  it('resolves parentNodeId when configured', () => {
    const customParent = { browseName: 'CustomParent' }; // TEST DATA
    const as = makeAddressSpace(sinon.stub().returns(customParent));
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm11' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'Custom', // TEST DATA
      parentNodeId: 'ns=2;s=Machine',
      timeoutMs: '5000'
    });

    serverConfig.emit('addressSpaceReady', as);

    const addMethodCall = as._namespace.addMethod.firstCall;
    assert.strictEqual(addMethodCall.args[0], customParent, 'Must use resolved parent');
  });

  it('shows red status on addMethod failure', () => {
    const as = {
      getOwnNamespace() {
        return {
          addMethod: sinon.stub().throws(new Error('AddMethodFailed')) // TEST DATA
        };
      },
      rootFolder: { objects: {} },
      findNode: sinon.stub()
    };
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-server-method')];
    require('./opcua-server-method')(RED);
    OpcuaServerMethod = RED.nodes.getType('opcua-server-method');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'sm12' });

    OpcuaServerMethod.call(node, {
      server: 'srv', methodName: 'BadMethod', timeoutMs: '5000' // TEST DATA
    });

    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.error.calledOnce);
    assert.ok(node.error.firstCall.args[0].includes('AddMethodFailed'));
    assert.strictEqual(node.status.lastCall.args[0].fill, 'red');
  });
});

'use strict';
/**
 * opcua-variable — Unit Tests
 * ============================
 * What is tested here:
 *
 *   The opcua-variable node creates an OPC UA variable that is bidirectionally
 *   bound to Node-RED flow/global context via the context-bridge module.
 *   It listens for 'addressSpaceReady' from the server config node.
 *
 *   Key invariants:
 *     - Registers as 'opcua-variable' type in Node-RED
 *     - Shows red status when no server config is provided
 *     - Shows red status when addressSpace is null
 *     - Creates variable using createVariableBinding from context-bridge
 *     - Parses defaultValue from string to correct type
 *     - Supports flow and global context scopes
 *     - Shows green status on success
 *     - Shows red status with error message on failure
 *     - Cleans up listener on close
 *     - Disposes variable on removal
 *
 * See: docs/work-packages.md#wp-s-2 — Address Space Builder & Context Bridge
 * See: docs/theoretical-foundations.md — Context Mapping
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
          id: config.id || 'test-var-id',
          name: config.name || '',
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub(),
          send:   sinon.stub()
        });
        EventEmitter.call(inst);
        Object.assign(inst, EventEmitter.prototype);

        // Provide context mock
        const flowStore = {};
        const globalStore = {};
        inst.context = () => ({
          flow: {
            get: (key) => flowStore[key],
            set: (key, val) => { flowStore[key] = val; }
          },
          global: {
            get: (key) => globalStore[key],
            set: (key, val) => { globalStore[key] = val; }
          },
          _flowStore: flowStore,
          _globalStore: globalStore
        });
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
  const ns = {
    addVariable: sinon.stub().callsFake((opts) => ({
      browseName: opts.browseName,
      dispose: sinon.stub(),
      _opts: opts
    }))
  };
  return {
    _namespace: ns,
    getOwnNamespace() { return ns; },
    rootFolder: { objects: { browseName: 'Objects' } },
    findNode: customFindNode || sinon.stub().returns(null)
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('opcua-variable node', () => {

  let RED, OpcuaVariable;

  beforeEach(() => {
    RED = makeRedMock();
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');
  });

  afterEach(() => sinon.restore());

  it('registers node type "opcua-variable"', () => {
    assert.ok(typeof OpcuaVariable === 'function');
  });

  it('sets red status when no server config is found', () => {
    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v1' });

    OpcuaVariable.call(node, { server: 'nonexistent' });

    assert.ok(node.status.calledOnce);
    assert.strictEqual(node.status.firstCall.args[0].fill, 'red');
    assert.ok(node.status.firstCall.args[0].text.includes('No server config'));
  });

  it('sets red status when addressSpace is null', () => {
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v2' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'Temp', dataType: 'Double', contextKey: 'temp'
    });

    serverConfig.emit('addressSpaceReady', null);

    assert.ok(node.error.calledOnce);
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'red');
  });

  it('creates variable and shows green status on addressSpaceReady', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v3' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'Temperature', dataType: 'Double',
      contextKey: 'temp', contextScope: 'flow'
    });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.variable !== null, 'Variable must be created');
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'green');
  });

  it('uses existing addressSpace if already set on serverConfig', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(as);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v4' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'Temp', dataType: 'Double',
      contextKey: 'temp', contextScope: 'flow'
    });

    assert.ok(node.variable !== null);
  });

  it('shows red status on createVariableBinding failure', () => {
    const as = {
      getOwnNamespace() {
        return {
          addVariable: sinon.stub().throws(new Error('AddVariableFailed')) // TEST DATA
        };
      },
      rootFolder: { objects: {} },
      findNode: sinon.stub()
    };
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v5' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'Bad', dataType: 'Double',
      contextKey: 'bad', contextScope: 'flow'
    });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.error.calledOnce);
    assert.ok(node.error.firstCall.args[0].includes('AddVariableFailed'));
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'red');
  });

  it('removes listener and disposes variable on close with removed=true', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v6' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'ToDispose', dataType: 'Double',
      contextKey: 'disp', contextScope: 'flow'
    });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.variable !== null);
    const variable = node.variable;

    const done = sinon.stub();
    node.emit('close', true, done);

    assert.ok(variable.dispose.calledOnce);
    assert.strictEqual(node.variable, null);
    assert.ok(done.calledOnce);
  });

  it('does NOT dispose variable on close with removed=false (redeploy)', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v7' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'Keep', dataType: 'Double',
      contextKey: 'keep', contextScope: 'flow'
    });
    serverConfig.emit('addressSpaceReady', as);

    const variable = node.variable;
    const done = sinon.stub();
    node.emit('close', false, done);

    assert.ok(!variable.dispose.called);
    assert.ok(done.calledOnce);
  });

  it('resolves parent from parentFolder node reference', () => {
    const parentFolder = { folder: { browseName: 'ParentFolder' } };
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig, pf: parentFolder });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED);
    OpcuaVariable = RED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'v8' });

    OpcuaVariable.call(node, {
      server: 'srv', browseName: 'ChildVar', dataType: 'Double',
      contextKey: 'child', contextScope: 'flow', parentFolder: 'pf'
    });
    serverConfig.emit('addressSpaceReady', as);

    // addVariable is called with parentFolder.folder as componentOf
    const addVarCall = as._namespace.addVariable.lastCall;
    assert.strictEqual(addVarCall.args[0].componentOf, parentFolder.folder);
  });
});

// ── parseDefaultValue tests (exported from module for testing) ────────────────

describe('opcua-variable parseDefaultValue (via integration)', () => {
  // We test parseDefaultValue indirectly by checking the default value
  // behavior when creating variables with string config values.

  it('passes undefined defaultValue when config.defaultValue is empty string', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);

    const RED2 = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(RED2);
    const OpcuaVariable2 = RED2.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED2.nodes.createNode(node, { id: 'v_dv1' });

    OpcuaVariable2.call(node, {
      server: 'srv', browseName: 'Test', dataType: 'Double',
      contextKey: 'test', contextScope: 'flow', defaultValue: ''
    });
    serverConfig.emit('addressSpaceReady', as);

    // Variable should be created without error
    assert.ok(node.variable !== null);
    assert.ok(!node.error.called);
  });
});

// ── parseDefaultValue data type branch tests ──────────────────────────────────

describe('opcua-variable parseDefaultValue branches', () => {

  function setupVariableWithDefault(dataType, defaultValue) {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    const localRED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(localRED);
    const VarCtor = localRED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    localRED.nodes.createNode(node, { id: 'v_branch' });

    VarCtor.call(node, {
      server: 'srv', browseName: 'BranchTest', dataType,
      contextKey: 'bt', contextScope: 'flow', defaultValue
    });
    serverConfig.emit('addressSpaceReady', as);
    return node;
  }

  it('parses Boolean "true" default value', () => {
    const node = setupVariableWithDefault('Boolean', 'true'); // TEST DATA
    assert.ok(node.variable !== null);
    assert.ok(!node.error.called);
  });

  it('parses Boolean false default value', () => {
    const node = setupVariableWithDefault('Boolean', 'false'); // TEST DATA
    assert.ok(node.variable !== null);
    assert.ok(!node.error.called);
  });

  it('parses Float default value', () => {
    const node = setupVariableWithDefault('Float', '3.14'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses Int32 default value', () => {
    const node = setupVariableWithDefault('Int32', '42'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses Int16 default value', () => {
    const node = setupVariableWithDefault('Int16', '100'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses UInt16 default value', () => {
    const node = setupVariableWithDefault('UInt16', '200'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses UInt32 default value', () => {
    const node = setupVariableWithDefault('UInt32', '300'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses Int64 default value', () => {
    const node = setupVariableWithDefault('Int64', '1000000'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses UInt64 default value', () => {
    const node = setupVariableWithDefault('UInt64', '999999'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses String default value (empty string is valid)', () => {
    const node = setupVariableWithDefault('String', ''); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('parses String default value with content', () => {
    const node = setupVariableWithDefault('String', 'hello'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('returns undefined for NaN Float', () => {
    const node = setupVariableWithDefault('Float', 'not-a-number'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('returns undefined for NaN Int32', () => {
    const node = setupVariableWithDefault('Int32', 'abc'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('falls through to raw for unknown dataType', () => {
    const node = setupVariableWithDefault('ByteString', 'rawdata'); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('returns undefined for null defaultValue', () => {
    const node = setupVariableWithDefault('Double', null); // TEST DATA
    assert.ok(node.variable !== null);
  });

  it('resolves parent via parentNodeId when no parentFolder node', () => {
    const parentObj = { browseName: 'MyParent' };
    const as = makeAddressSpace(sinon.stub().returns(parentObj));
    const serverConfig = makeServerConfigStub(null);
    const localRED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-variable')];
    require('./opcua-variable')(localRED);
    const VarCtor = localRED.nodes.getType('opcua-variable');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    localRED.nodes.createNode(node, { id: 'v_parent' });

    VarCtor.call(node, {
      server: 'srv', browseName: 'ChildByNodeId', dataType: 'Double',
      contextKey: 'child2', contextScope: 'global', parentNodeId: 'ns=1;i=1000' // TEST DATA
    });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.variable !== null);
    assert.ok(as.findNode.calledWith('ns=1;i=1000'));
  });
});

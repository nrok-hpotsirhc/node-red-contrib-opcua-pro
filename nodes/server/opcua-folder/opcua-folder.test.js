'use strict';
/**
 * opcua-folder — Unit Tests
 * =========================
 * What is tested here:
 *
 *   The opcua-folder node creates a folder in the OPC UA server address space.
 *   It listens for 'addressSpaceReady' from the server config node and builds
 *   the folder hierarchy programmatically via namespace.addFolder().
 *
 *   Key invariants:
 *     - Registers as 'opcua-folder' type in Node-RED
 *     - Shows red status when no server config is provided
 *     - Shows red status when addressSpace is null
 *     - Creates folder under Objects by default
 *     - Creates folder under a parent folder node if configured
 *     - Creates folder under a parentNodeId if configured
 *     - Falls back to browseName from config, then node.name, then 'Folder'
 *     - Shows green status on success
 *     - Shows red status with error message on failure
 *     - Cleans up listener on close
 *     - Disposes folder on removal
 *
 * See: docs/work-packages.md#wp-s-2 — Address Space Builder & Context Bridge
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
          id: config.id || 'test-folder-id',
          name: config.name || '',
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub()
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
  const ns = {
    addFolder: sinon.stub().callsFake((_parent, opts) => ({
      browseName: opts.browseName,
      dispose: sinon.stub()
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

describe('opcua-folder node', () => {

  let RED, OpcuaFolder;

  beforeEach(() => {
    RED = makeRedMock();
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');
  });

  afterEach(() => sinon.restore());

  it('registers node type "opcua-folder"', () => {
    assert.ok(typeof OpcuaFolder === 'function');
  });

  it('sets red status when no server config is found', () => {
    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f1' });

    OpcuaFolder.call(node, { server: 'nonexistent' });

    assert.ok(node.status.calledOnce);
    assert.strictEqual(node.status.firstCall.args[0].fill, 'red');
    assert.ok(node.status.firstCall.args[0].text.includes('No server config'));
  });

  it('sets red status when addressSpace is null', () => {
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f2' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'TestFolder' });

    // Trigger with null addressSpace
    serverConfig.emit('addressSpaceReady', null);

    assert.ok(node.error.calledOnce);
    assert.ok(node.status.called);
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'red');
  });

  it('creates folder under Objects by default and shows green status', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f3' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Machines' });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.folder !== null, 'Folder must be created');
    assert.strictEqual(node.folder.browseName, 'Machines');
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'green');
  });

  it('uses config.browseName, falls back to node.name, then "Folder"', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    // No browseName, has name — name is passed in the OpcuaFolder config
    const node1 = Object.create(EventEmitter.prototype);
    EventEmitter.call(node1);
    RED.nodes.createNode(node1, { id: 'f4' });
    OpcuaFolder.call(node1, { server: 'srv', browseName: '', name: 'MyFolder' });
    serverConfig.emit('addressSpaceReady', as);
    assert.strictEqual(node1.folder.browseName, 'MyFolder');

    // No browseName, no name → 'Folder'
    const node2 = Object.create(EventEmitter.prototype);
    EventEmitter.call(node2);
    RED.nodes.createNode(node2, { id: 'f5' });
    OpcuaFolder.call(node2, { server: 'srv', browseName: '' });
    serverConfig.emit('addressSpaceReady', as);
    assert.strictEqual(node2.folder.browseName, 'Folder');
  });

  it('creates folder under parentFolder node when configured', () => {
    const parentFolder = { folder: { browseName: 'ParentFolder' } };
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig, pf: parentFolder });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f6' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Child', parentFolder: 'pf' });
    serverConfig.emit('addressSpaceReady', as);

    // Verify addFolder was called with the parent folder
    const addFolderCall = as._namespace.addFolder.lastCall;
    assert.strictEqual(addFolderCall.args[0], parentFolder.folder);
  });

  it('creates folder under parentNodeId when configured', () => {
    const customParent = { browseName: 'CustomParent' };
    const as = makeAddressSpace(sinon.stub().returns(customParent));
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f7' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Sub', parentNodeId: 'ns=2;s=Root' });
    serverConfig.emit('addressSpaceReady', as);

    const addFolderCall = as._namespace.addFolder.lastCall;
    assert.strictEqual(addFolderCall.args[0], customParent);
  });

  it('shows red status with error message on addFolder failure', () => {
    const as = {
      getOwnNamespace() {
        return {
          addFolder: sinon.stub().throws(new Error('AddFolderFailed')) // TEST DATA
        };
      },
      rootFolder: { objects: {} },
      findNode: sinon.stub()
    };
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f8' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Bad' });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.error.calledOnce);
    assert.ok(node.error.firstCall.args[0].includes('AddFolderFailed'));
    const lastStatus = node.status.lastCall.args[0];
    assert.strictEqual(lastStatus.fill, 'red');
  });

  it('removes listener and disposes folder on close with removed=true', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f9' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'ToDispose' });
    serverConfig.emit('addressSpaceReady', as);

    assert.ok(node.folder !== null);
    const folder = node.folder;

    // Close with removed=true
    const done = sinon.stub();
    node.emit('close', true, done);

    assert.ok(folder.dispose.calledOnce, 'folder.dispose() must be called on removal');
    assert.strictEqual(node.folder, null);
    assert.ok(done.calledOnce, 'done callback must be called');
  });

  it('does NOT dispose folder on close with removed=false (redeploy)', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(null);
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f10' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Keep' });
    serverConfig.emit('addressSpaceReady', as);

    const folder = node.folder;
    const done = sinon.stub();
    node.emit('close', false, done);

    assert.ok(!folder.dispose.called, 'folder must NOT be disposed on redeploy');
    assert.ok(done.calledOnce);
  });

  it('uses existing addressSpace if already set on serverConfig', () => {
    const as = makeAddressSpace();
    const serverConfig = makeServerConfigStub(as); // addressSpace already set
    RED = makeRedMock({ srv: serverConfig });
    delete require.cache[require.resolve('./opcua-folder')];
    require('./opcua-folder')(RED);
    OpcuaFolder = RED.nodes.getType('opcua-folder');

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'f11' });

    OpcuaFolder.call(node, { server: 'srv', browseName: 'Existing' });

    // Should have created the folder immediately
    assert.ok(node.folder !== null);
    assert.strictEqual(node.folder.browseName, 'Existing');
  });
});

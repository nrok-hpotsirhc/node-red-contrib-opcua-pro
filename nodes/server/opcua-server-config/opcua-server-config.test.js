'use strict';
// Unit tests for opcua-server-config lifecycle (M1 acceptance criteria)
// Verifies no port conflict on re-deploy (shutdown called before re-start)

const assert   = require('assert');
const sinon    = require('sinon');
const EventEmitter = require('events');

// ─── Minimal RED mock ─────────────────────────────────────────────────────────

function makeRedMock() {
  const nodes = {};
  return {
    nodes: {
      createNode(nodeInstance, config) {
        Object.assign(nodeInstance, {
          id:     config.id || 'test-node-id',
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub()
        });
        EventEmitter.call(nodeInstance);
        Object.assign(nodeInstance, EventEmitter.prototype);
      },
      registerType(name, Constructor) {
        nodes[name] = Constructor;
      },
      getType(name) { return nodes[name]; },
      getNode() { return null; }
    },
    httpAdmin: {
      get:  sinon.stub(),
      post: sinon.stub()
    },
    auth: {
      needsPermission: sinon.stub().returns((req, res, next) => next && next())
    },
    settings: {
      userDir: require('os').tmpdir()
    }
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('opcua-server-config lifecycle', () => {

  let RED;
  let ServerConfig;

  beforeEach(() => {
    RED = makeRedMock();
    // Re-require so RED mock is injected fresh
    delete require.cache[require.resolve('./opcua-server-config')];
    require('./opcua-server-config')(RED);
    ServerConfig = RED.nodes.getType('opcua-server-config');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('registers node type "opcua-server-config"', () => {
    assert.ok(typeof ServerConfig === 'function');
  });

  // ─── Helper: inject a mock OPCUAServer via require.cache ──────────────────
  // opcua-server-config.js captures OPCUAServer at require time, so we must
  // inject the mock through the module cache before re-requiring the module.
  function requireWithMockServer(serverFactory) {
    const opcuaPath = require.resolve('node-opcua');
    const originalOpcua = require.cache[opcuaPath];
    require.cache[opcuaPath] = {
      id: opcuaPath,
      filename: opcuaPath,
      loaded: true,
      exports: { ...require('node-opcua'), OPCUAServer: serverFactory }
    };

    delete require.cache[require.resolve('./opcua-server-config')];
    require('./opcua-server-config')(RED);
    const MockedConfig = RED.nodes.getType('opcua-server-config');

    // Restore the node-opcua cache entry immediately
    require.cache[opcuaPath] = originalOpcua;
    return MockedConfig;
  }

  it('calls server.shutdown() on close to release TCP port', async () => {
    const shutdownStub = sinon.stub().resolves();
    const serverStub = {
      initialize: sinon.stub().resolves(),
      start:      sinon.stub().resolves(),
      shutdown:   shutdownStub,
      on(evt, cb) {
        if (evt === 'post_initialize') setImmediate(cb);
        return this;
      },
      engine: { addressSpace: {} }
    };

    const MockedServerConfig = requireWithMockServer(function () { return serverStub; });

    const node = Object.create(EventEmitter.prototype);
    EventEmitter.call(node);
    RED.nodes.createNode(node, { id: 'srv1' });

    // Instantiate
    MockedServerConfig.call(node, { port: '4840', resourcePath: '/UA', productName: 'Test' });

    // Wait for the post_initialize event to fire (includes async cert generation)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Trigger close
    await new Promise(resolve => {
      node.emit('close', false, resolve);
    });

    assert.ok(shutdownStub.calledOnce, 'shutdown() must be called on close');
  });

  it('logs error on start failure, does not throw', async () => {
    const MockedServerConfig = requireWithMockServer(function () {
      return {
        initialize: sinon.stub().rejects(new Error('EADDRINUSE')),
        start:      sinon.stub(),
        on:         sinon.stub().returnsThis(),
        engine:     { addressSpace: {} }
      };
    });

    const nodeEvt = Object.create(EventEmitter.prototype);
    EventEmitter.call(nodeEvt);
    RED.nodes.createNode(nodeEvt, { id: 'srv2' });

    // Should not throw — error is caught internally
    MockedServerConfig.call(nodeEvt, { port: '4840', resourcePath: '/UA', productName: 'Test' });

    // Wait for the async startServer() to complete (includes cert generation and fail internally)
    await new Promise(resolve => setTimeout(resolve, 3000));

    assert.ok(nodeEvt.error.calledOnce, 'node.error() must be called on start failure');
    assert.ok(nodeEvt.error.firstCall.args[0].includes('EADDRINUSE'),
      'error message must contain the original error');
  });
});

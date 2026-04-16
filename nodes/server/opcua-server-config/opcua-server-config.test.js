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

// ─── Server PKI HTTP Routes (WP-S-5) ─────────────────────────────────────────

/**
 * RED mock that captures httpAdmin route handlers (same pattern as browse-route.test.js).
 * The nodeStore is exposed so tests can inject fake config nodes looked up by getNode().
 */
function makeRedMockWithRoutes() {
  const nodes     = {};
  const nodeStore = {};
  const routes    = { get: {}, post: {} };

  return {
    nodes: {
      createNode(nodeInstance, config) {
        Object.assign(nodeInstance, {
          id:     config.id || 'test-node-id', // TEST DATA
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub()
        });
        EventEmitter.call(nodeInstance);
        Object.assign(nodeInstance, EventEmitter.prototype);
        nodeStore[config.id || 'test-node-id'] = nodeInstance;
      },
      registerType(name, Constructor) {
        nodes[name] = Constructor;
      },
      getType(name) { return nodes[name]; },
      getNode(id) { return nodeStore[id] || null; }
    },
    httpAdmin: {
      get(path, ...args)  { routes.get[path]  = args[args.length - 1]; },
      post(path, ...args) { routes.post[path] = args[args.length - 1]; }
    },
    auth: {
      needsPermission: sinon.stub().returns((req, res, next) => next && next())
    },
    settings: {
      userDir: require('os').tmpdir()
    },
    _routes: routes,
    _nodeStore: nodeStore
  };
}

/** Minimal mock response object (mirrors browse-route.test.js pattern). */
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; }
  };
  return res;
}

describe('Server PKI HTTP Routes (WP-S-5)', () => {

  let RED;
  let rejectedHandler, trustedHandler, trustHandler;
  // Stubs injected into the module via require cache — route handlers close over these
  let listRejectedStub, listTrustedStub, trustCertStub;

  before(() => {
    RED = makeRedMockWithRoutes();

    // Create stubs that the route handlers will close over after destructuring
    listRejectedStub = sinon.stub();
    listTrustedStub  = sinon.stub();
    trustCertStub    = sinon.stub();

    // Inject mock pki-manager into require cache BEFORE loading opcua-server-config
    const pkiManagerPath    = require.resolve('../../../lib/server/pki-manager');
    const originalPkiModule = require.cache[pkiManagerPath];
    require.cache[pkiManagerPath] = {
      id: pkiManagerPath,
      filename: pkiManagerPath,
      loaded: true,
      exports: {
        ensureServerPkiDirectories: sinon.stub(),
        ensureServerCertificate:    sinon.stub().resolves({ certFile: 'c', keyFile: 'k' }), // TEST DATA
        listRejectedClientCertificates: listRejectedStub,
        trustClientCertificate:         trustCertStub,
        listTrustedClientCertificates:  listTrustedStub
      }
    };

    delete require.cache[require.resolve('./opcua-server-config')];
    require('./opcua-server-config')(RED);

    // Restore real pki-manager so other tests are unaffected
    require.cache[pkiManagerPath] = originalPkiModule;

    rejectedHandler = RED._routes.get['/opcua-admin/server-pki/rejected'];
    trustedHandler  = RED._routes.get['/opcua-admin/server-pki/trusted'];
    trustHandler    = RED._routes.post['/opcua-admin/server-pki/trust'];
  });

  afterEach(() => {
    listRejectedStub.reset();
    listTrustedStub.reset();
    trustCertStub.reset();
  });

  // ── Route registration ────────────────────────────────────────────────────

  it('registers all three server-PKI routes', () => {
    assert.ok(typeof rejectedHandler === 'function', 'rejected handler must be registered');
    assert.ok(typeof trustedHandler  === 'function', 'trusted handler must be registered');
    assert.ok(typeof trustHandler    === 'function', 'trust handler must be registered');
  });

  // ── GET /opcua-admin/server-pki/rejected ──────────────────────────────────

  describe('GET /opcua-admin/server-pki/rejected', () => {

    it('returns 400 when configId is missing', () => {
      const res = mockRes();
      rejectedHandler({ query: {} }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 400 when configId contains invalid characters', () => {
      const res = mockRes();
      rejectedHandler({ query: { configId: '../etc/passwd' } }, res); // TEST DATA — path traversal attempt
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 404 when config node does not exist', () => {
      const res = mockRes();
      rejectedHandler({ query: { configId: 'nonexistent99' } }, res); // TEST DATA — no such node
      assert.strictEqual(res.statusCode, 404);
      assert.ok(res.body.error.includes('Config node not found'));
    });

    it('returns 404 when config node has no pkiDir', () => {
      RED._nodeStore['nopkidir1'] = { pkiDir: undefined }; // TEST DATA — node without pkiDir
      const res = mockRes();
      rejectedHandler({ query: { configId: 'nopkidir1' } }, res);
      assert.strictEqual(res.statusCode, 404);
    });

    it('returns list of rejected certificates on success', () => {
      RED._nodeStore['srvpki1'] = { pkiDir: '/fake/pki' }; // TEST DATA
      listRejectedStub.returns(['clientA.der', 'clientB.der']); // TEST DATA — fake cert filenames
      const res = mockRes();
      rejectedHandler({ query: { configId: 'srvpki1' } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, [
        { name: 'clientA.der' },  // TEST DATA
        { name: 'clientB.der' }   // TEST DATA
      ]);
      assert.ok(listRejectedStub.calledOnceWith('/fake/pki')); // TEST DATA
    });

    it('returns empty array when no rejected certificates', () => {
      RED._nodeStore['srvpki2'] = { pkiDir: '/fake/pki2' }; // TEST DATA
      listRejectedStub.returns([]);
      const res = mockRes();
      rejectedHandler({ query: { configId: 'srvpki2' } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, []);
    });

    it('returns 500 when listRejectedClientCertificates throws', () => {
      RED._nodeStore['srvpki3'] = { pkiDir: '/fake/pki3' }; // TEST DATA
      listRejectedStub.throws(new Error('ENOENT: no such file or directory')); // TEST DATA — simulated fs error
      const res = mockRes();
      rejectedHandler({ query: { configId: 'srvpki3' } }, res);
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.body.error.includes('ENOENT'));
    });
  });

  // ── GET /opcua-admin/server-pki/trusted ───────────────────────────────────

  describe('GET /opcua-admin/server-pki/trusted', () => {

    it('returns 400 when configId is missing', () => {
      const res = mockRes();
      trustedHandler({ query: {} }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 400 when configId contains invalid characters', () => {
      const res = mockRes();
      trustedHandler({ query: { configId: 'abc;rm -rf' } }, res); // TEST DATA — shell injection attempt
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 404 when config node does not exist', () => {
      const res = mockRes();
      trustedHandler({ query: { configId: 'nonexistent88' } }, res); // TEST DATA
      assert.strictEqual(res.statusCode, 404);
      assert.ok(res.body.error.includes('Config node not found'));
    });

    it('returns list of trusted certificates on success', () => {
      RED._nodeStore['srvpki4'] = { pkiDir: '/fake/pki4' }; // TEST DATA
      listTrustedStub.returns(['trusted1.der', 'trusted2.der']); // TEST DATA — fake cert filenames
      const res = mockRes();
      trustedHandler({ query: { configId: 'srvpki4' } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, [
        { name: 'trusted1.der' },  // TEST DATA
        { name: 'trusted2.der' }   // TEST DATA
      ]);
      assert.ok(listTrustedStub.calledOnceWith('/fake/pki4')); // TEST DATA
    });

    it('returns empty array when no trusted certificates', () => {
      RED._nodeStore['srvpki5'] = { pkiDir: '/fake/pki5' }; // TEST DATA
      listTrustedStub.returns([]);
      const res = mockRes();
      trustedHandler({ query: { configId: 'srvpki5' } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, []);
    });

    it('returns 500 when listTrustedClientCertificates throws', () => {
      RED._nodeStore['srvpki6'] = { pkiDir: '/fake/pki6' }; // TEST DATA
      listTrustedStub.throws(new Error('Permission denied')); // TEST DATA — simulated fs error
      const res = mockRes();
      trustedHandler({ query: { configId: 'srvpki6' } }, res);
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.body.error.includes('Permission denied'));
    });
  });

  // ── POST /opcua-admin/server-pki/trust ────────────────────────────────────

  describe('POST /opcua-admin/server-pki/trust', () => {

    it('returns 400 when configId is missing', () => {
      const res = mockRes();
      trustHandler({ body: {} }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 400 when configId contains invalid characters', () => {
      const res = mockRes();
      trustHandler({ body: { configId: '../hack' } }, res); // TEST DATA
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid configId'));
    });

    it('returns 400 when body is null', () => {
      const res = mockRes();
      trustHandler({ body: null }, res);
      assert.strictEqual(res.statusCode, 400);
    });

    it('returns 400 when filename is missing', () => {
      RED._nodeStore['srvpki7'] = { pkiDir: '/fake/pki7' }; // TEST DATA
      const res = mockRes();
      trustHandler({ body: { configId: 'srvpki7' } }, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Missing filename'));
    });

    it('returns 400 when filename is not a string', () => {
      RED._nodeStore['srvpki8'] = { pkiDir: '/fake/pki8' }; // TEST DATA
      const res = mockRes();
      trustHandler({ body: { configId: 'srvpki8', filename: 12345 } }, res); // TEST DATA — non-string
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Missing filename'));
    });

    it('returns 404 when config node does not exist', () => {
      const res = mockRes();
      trustHandler({ body: { configId: 'nonexistent77', filename: 'cert.der' } }, res); // TEST DATA
      assert.strictEqual(res.statusCode, 404);
      assert.ok(res.body.error.includes('Config node not found'));
    });

    it('returns 400 for path traversal filename', () => {
      RED._nodeStore['srvpki9'] = { pkiDir: '/fake/pki9' }; // TEST DATA
      trustCertStub.throws(new Error('Invalid certificate filename: contains path traversal')); // TEST DATA
      const res = mockRes();
      trustHandler({ body: { configId: 'srvpki9', filename: '../evil.der' } }, res); // TEST DATA — traversal
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid certificate filename'));
    });

    it('returns success on valid trust operation', () => {
      RED._nodeStore['srvpki10'] = { pkiDir: '/fake/pki10' }; // TEST DATA
      // trustCertStub default behavior: returns undefined (no throw) — simulates success
      const res = mockRes();
      trustHandler({ body: { configId: 'srvpki10', filename: 'client.der' } }, res); // TEST DATA
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { success: true });
      assert.ok(trustCertStub.calledOnceWith('/fake/pki10', 'client.der')); // TEST DATA
    });

    it('returns 500 when trustClientCertificate throws non-validation error', () => {
      RED._nodeStore['srvpki11'] = { pkiDir: '/fake/pki11' }; // TEST DATA
      trustCertStub.throws(new Error('Disk full')); // TEST DATA — simulated fs error
      const res = mockRes();
      trustHandler({ body: { configId: 'srvpki11', filename: 'cert.der' } }, res); // TEST DATA
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.body.error.includes('Disk full'));
    });
  });
});

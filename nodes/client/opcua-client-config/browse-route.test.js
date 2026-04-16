'use strict';
/**
 * Browse Route — Unit Tests (WP-C-4)
 * ===================================
 * Tests the HTTP browse route registered on RED.httpAdmin by opcua-client-config.
 *
 * What is tested:
 *   - Route registration (GET /opcua-admin/browse)
 *   - Input validation: missing configId, invalid configId, path traversal in nodeId
 *   - 503 when no active session
 *   - Successful browse returns mapped node array
 *   - Error handling when session.browse throws
 *   - PKI routes registration (GET/POST for rejected/trusted/trust)
 *
 * See: docs/work-packages.md#wp-c-4 — Visueller Tree-View Browser
 */
const assert       = require('assert');
const sinon        = require('sinon');
const EventEmitter = require('events');

// ─── Minimal RED mock that captures httpAdmin route handlers ─────────────────

function makeRedMock() {
  const nodes     = {};
  const nodeStore = {};
  const routes    = { get: {}, post: {} };

  return {
    nodes: {
      createNode(nodeInstance, config) {
        Object.assign(nodeInstance, {
          id:     config.id || 'test-id',
          status: sinon.stub(),
          error:  sinon.stub(),
          warn:   sinon.stub(),
          log:    sinon.stub()
        });
        EventEmitter.call(nodeInstance);
        Object.assign(nodeInstance, EventEmitter.prototype);
        nodeStore[config.id || 'test-id'] = nodeInstance;
      },
      registerType(name, Constructor, opts) {
        nodes[name] = Constructor;
      },
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
    // Test helpers
    _routes: routes,
    _nodeStore: nodeStore
  };
}

// Mock response object
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; }
  };
  return res;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Browse Route (WP-C-4)', () => {

  let RED;
  let browseHandler;

  before(() => {
    RED = makeRedMock();
    delete require.cache[require.resolve('./opcua-client-config')];
    require('./opcua-client-config')(RED);
    browseHandler = RED._routes.get['/opcua-admin/browse'];
  });

  it('registers GET /opcua-admin/browse route', () => {
    assert.ok(typeof browseHandler === 'function', 'Browse handler must be registered');
  });

  it('returns 400 when configId is missing', async () => {
    const res = mockRes();
    await browseHandler({ query: {} }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Invalid configId'));
  });

  it('returns 400 when configId contains invalid characters', async () => {
    const res = mockRes();
    await browseHandler({ query: { configId: '../etc/passwd' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Invalid configId'));
  });

  it('returns 400 when configId contains shell metacharacters', async () => {
    const res = mockRes();
    await browseHandler({ query: { configId: 'abc;rm -rf /' } }, res);
    assert.strictEqual(res.statusCode, 400);
  });

  it('returns 503 when config node has no session', async () => {
    RED._nodeStore['nosession1'] = { session: null };
    const res = mockRes();
    await browseHandler({ query: { configId: 'nosession1', nodeId: 'RootFolder' } }, res);
    assert.strictEqual(res.statusCode, 503);
    assert.ok(res.body.error.includes('No active session'));
  });

  it('returns 503 when config node does not exist', async () => {
    const res = mockRes();
    await browseHandler({ query: { configId: 'nonexistent99', nodeId: 'RootFolder' } }, res);
    assert.strictEqual(res.statusCode, 503);
  });

  it('returns 400 for nodeId with shell metacharacters', async () => {
    RED._nodeStore['validnode1'] = {
      session: { browse: sinon.stub().resolves({ references: [] }) }
    };
    const res = mockRes();
    await browseHandler({ query: { configId: 'validnode1', nodeId: 'ns=1;s=<script>' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Invalid nodeId'));
  });

  it('returns mapped browse results on success', async () => {
    const mockSession = {
      browse: sinon.stub().resolves({
        references: [
          {
            nodeId: { toString: () => 'ns=0;i=85' },
            displayName: { text: 'Objects' },
            browseName:  { name: 'Objects' },
            nodeClass: 1  // Object
          },
          {
            nodeId: { toString: () => 'ns=1;s=Temperature' },
            displayName: { text: 'Temperature' },
            browseName:  { name: 'Temperature' },
            nodeClass: 2  // Variable
          }
        ]
      })
    };
    RED._nodeStore['validcfg1'] = { session: mockSession };

    const res = mockRes();
    await browseHandler({ query: { configId: 'validcfg1', nodeId: 'RootFolder' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 2);
    assert.strictEqual(res.body[0].nodeId, 'ns=0;i=85');
    assert.strictEqual(res.body[0].displayName, 'Objects');
    assert.strictEqual(res.body[1].nodeId, 'ns=1;s=Temperature');
  });

  it('defaults nodeId to RootFolder when not provided', async () => {
    const mockSession = {
      browse: sinon.stub().resolves({ references: [] })
    };
    RED._nodeStore['validcfg2'] = { session: mockSession };

    const res = mockRes();
    await browseHandler({ query: { configId: 'validcfg2' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(mockSession.browse.calledOnce);
    const browseArg = mockSession.browse.firstCall.args[0];
    assert.strictEqual(browseArg.nodeId, 'RootFolder');
  });

  it('returns 500 when session.browse throws', async () => {
    const mockSession = {
      browse: sinon.stub().rejects(new Error('BadNodeIdUnknown'))
    };
    RED._nodeStore['validcfg3'] = { session: mockSession };

    const res = mockRes();
    await browseHandler({ query: { configId: 'validcfg3', nodeId: 'ns=999;i=0' } }, res);

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.error.includes('BadNodeIdUnknown'));
  });

  it('handles empty references array', async () => {
    const mockSession = {
      browse: sinon.stub().resolves({ references: [] })
    };
    RED._nodeStore['validcfg4'] = { session: mockSession };

    const res = mockRes();
    await browseHandler({ query: { configId: 'validcfg4', nodeId: 'ns=1;s=Empty' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, []);
  });

  it('handles null references gracefully', async () => {
    const mockSession = {
      browse: sinon.stub().resolves({ references: null })
    };
    RED._nodeStore['validcfg5'] = { session: mockSession };

    const res = mockRes();
    await browseHandler({ query: { configId: 'validcfg5', nodeId: 'RootFolder' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, []);
  });
});

// ─── PKI Routes (WP-C-5) ─────────────────────────────────────────────────────

describe('PKI HTTP Routes (WP-C-5)', () => {

  let RED;
  let rejectedHandler, trustedHandler, trustHandler;

  before(() => {
    RED = makeRedMock();
    delete require.cache[require.resolve('./opcua-client-config')];
    require('./opcua-client-config')(RED);
    rejectedHandler = RED._routes.get['/opcua-admin/pki/rejected'];
    trustedHandler  = RED._routes.get['/opcua-admin/pki/trusted'];
    trustHandler    = RED._routes.post['/opcua-admin/pki/trust'];
  });

  it('registers all PKI routes', () => {
    assert.ok(typeof rejectedHandler === 'function', 'rejected route must exist');
    assert.ok(typeof trustedHandler  === 'function', 'trusted route must exist');
    assert.ok(typeof trustHandler    === 'function', 'trust route must exist');
  });

  it('rejected route returns 400 for missing configId', () => {
    const res = mockRes();
    rejectedHandler({ query: {} }, res);
    assert.strictEqual(res.statusCode, 400);
  });

  it('rejected route returns 404 for non-existent config node', () => {
    const res = mockRes();
    rejectedHandler({ query: { configId: 'nonexistent1' } }, res);
    assert.strictEqual(res.statusCode, 404);
  });

  it('trust route returns 400 for missing filename', () => {
    RED._nodeStore['pkicfg1'] = { pkiDir: '/tmp/nonexistent-pki' };
    const res = mockRes();
    trustHandler({ body: { configId: 'pkicfg1' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Missing filename'));
  });

  it('trust route returns 400 for path traversal filename', () => {
    RED._nodeStore['pkicfg2'] = { pkiDir: '/tmp/nonexistent-pki' };
    const res = mockRes();
    trustHandler({ body: { configId: 'pkicfg2', filename: '../evil.der' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error.includes('Invalid certificate filename'));
  });

  it('trust route returns 400 for null body', () => {
    const res = mockRes();
    trustHandler({ body: null }, res);
    assert.strictEqual(res.statusCode, 400);
  });
});

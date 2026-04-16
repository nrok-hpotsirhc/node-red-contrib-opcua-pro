'use strict';
/**
 * opcua-method-response — Unit Tests
 * =====================================
 * What is tested here:
 *
 *   The opcua-method-response node sends correlated responses back to
 *   pending OPC UA method calls using msg._opcua_method_id.
 *
 * Why these test cases:
 *   - Registers as "opcua-method-response" type
 *   - Shows red status when no method node configured
 *   - Shows green "Ready" status when method node is found
 *   - Warns when msg._opcua_method_id is missing
 *   - Warns when linked method node is not found
 *   - Warns when no pending call matches the correlation ID
 *   - Successfully resolves a pending call and clears timeout
 *   - Cleanup on close calls done()
 *
 * See: docs/work-packages.md#wp-s-4 — RPC-Methoden & Event Handling
 */
const assert = require('assert');

// ── Mock Node-RED runtime ─────────────────────────────────────────────────

function createMockRED(externalNodes = {}) {
  const registeredTypes = {};

  return {
    nodes: {
      registerType: (name, ctor) => { registeredTypes[name] = ctor; },
      createNode:   (node, config) => {
        node.id = config.id || 'test-resp-id'; // TEST DATA
        node._handlers = {};
        node.on = (evt, fn) => { node._handlers[evt] = fn; };
        node.status = (s) => { node._lastStatus = s; };
        node.error  = (msg) => { node._lastError = msg; };
        node.warn   = (msg) => { node._lastWarn = msg; };
        node.send   = (msg) => { node._lastSent = msg; };
      },
      getNode: (id) => externalNodes[id] || null
    },
    registeredTypes
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('opcua-method-response node', () => {

  it('registers as "opcua-method-response" type', () => {
    const RED = createMockRED();
    require('./opcua-method-response')(RED);
    assert.ok(RED.registeredTypes['opcua-method-response']);
  });

  it('shows red status when no method node is configured', () => {
    const RED = createMockRED();
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'missing' }); // TEST DATA

    assert.strictEqual(node._lastStatus.fill, 'red');
    assert.ok(node._lastStatus.text.includes('No method node'));
  });

  it('shows green "Ready" status when method node is found', () => {
    const methodNode = { pendingCalls: new Map() }; // TEST DATA
    const RED = createMockRED({ meth1: methodNode });
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'meth1' });

    assert.strictEqual(node._lastStatus.fill, 'green');
    assert.strictEqual(node._lastStatus.text, 'Ready');
  });

  it('warns when msg._opcua_method_id is missing', () => {
    const RED = createMockRED();
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'meth1' });

    let doneCalled = false;
    node._handlers.input({}, undefined, () => { doneCalled = true; });

    assert.ok(node._lastWarn);
    assert.ok(node._lastWarn.includes('_opcua_method_id'));
    assert.ok(doneCalled);
  });

  it('warns when linked method node is not found at runtime', () => {
    const RED = createMockRED(); // no method node registered
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'missing' }); // TEST DATA

    let doneCalled = false;
    node._handlers.input(
      { _opcua_method_id: 'some-uuid' }, // TEST DATA
      undefined,
      () => { doneCalled = true; }
    );

    assert.ok(node._lastWarn);
    assert.ok(node._lastWarn.includes('not found'));
    assert.ok(doneCalled);
  });

  it('warns when no pending call matches the correlation ID', () => {
    const methodNode = { pendingCalls: new Map() };
    const RED = createMockRED({ meth1: methodNode });
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'meth1' });

    let doneCalled = false;
    node._handlers.input(
      { _opcua_method_id: 'nonexistent-uuid' }, // TEST DATA
      undefined,
      () => { doneCalled = true; }
    );

    assert.ok(node._lastWarn);
    assert.ok(node._lastWarn.includes('No pending call'));
    assert.ok(doneCalled);
  });

  it('successfully resolves a pending call and clears timeout', () => {
    const timeout = setTimeout(() => {}, 30000); // TEST DATA — long timeout
    const pendingCalls = new Map();
    let resolvedWith = null;

    pendingCalls.set('test-uuid-123', { // TEST DATA
      resolve: (val) => { resolvedWith = val; },
      reject: () => {},
      timeout
    });

    const methodNode = { pendingCalls };
    const RED = createMockRED({ meth1: methodNode });
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'meth1' });

    let doneCalled = false;
    node._handlers.input(
      { _opcua_method_id: 'test-uuid-123', payload: [42, 'hello'] }, // TEST DATA
      undefined,
      () => { doneCalled = true; }
    );

    assert.deepStrictEqual(resolvedWith, [42, 'hello']);
    assert.strictEqual(pendingCalls.size, 0, 'Pending call must be removed');
    assert.ok(doneCalled);
    clearTimeout(timeout); // Cleanup
  });

  it('cleanup on close calls done()', () => {
    const RED = createMockRED();
    require('./opcua-method-response')(RED);

    const node = {};
    RED.registeredTypes['opcua-method-response'].call(node, { methodNode: 'meth1' });

    let doneCalled = false;
    node._handlers.close(false, () => { doneCalled = true; });
    assert.ok(doneCalled);
  });
});

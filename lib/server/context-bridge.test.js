'use strict';
/**
 * Context Bridge — Unit Tests
 * ===========================
 * What is tested here:
 *
 *   The context-bridge is the "live data glue" between the OPC UA server and
 *   Node-RED flows.  When a SCADA client reads an OPC UA variable, the
 *   getter() reads from flow/global context.  When a SCADA client writes,
 *   the setter() writes to context and optionally injects a message into the
 *   flow for downstream processing.
 *
 *   Key functions:
 *     resolveDataType(typeName)  — maps string like "Double" to DataType.Double
 *     createVariableBinding(ns, parentNode, nodeConfig, flowContext, ownerNode)
 *       — calls namespace.addVariable() and returns the UA node
 *
 * Why these test cases:
 *   - resolveDataType: all standard industrial types are mapped correctly
 *   - resolveDataType with unknown type: returns DataType.Variant (safe fallback)
 *   - getter reads current flow context value
 *   - getter returns defaultValue when context key is not set
 *   - setter writes new value to flow context
 *   - setter returns StatusCodes.Good on success
 *   - setter sends a message when triggerOnWrite is true
 *   - setter does NOT send a message when triggerOnWrite is false
 *   - setter returns StatusCodes.BadInternalError when context.set() throws
 *   - addVariable is called with the config's browseName
 *
 * See: docs/work-packages.md#wp-s-2 — Address Space Builder & Context Bridge
 * See: docs/theoretical-foundations.md — Context Mapping
 */
const assert = require('assert');
const { resolveDataType, createVariableBinding } = require('./context-bridge');
const { DataType, StatusCodes, Variant } = require('node-opcua');

// ── resolveDataType ───────────────────────────────────────────────────────────

describe('resolveDataType()', () => {

  const cases = [
    ['Boolean',  DataType.Boolean],
    ['ByteString', DataType.ByteString],
    ['NodeId', DataType.NodeId],
    ['Double',   DataType.Double],
    ['Float',    DataType.Float],
    ['Int16',    DataType.Int16],
    ['Int32',    DataType.Int32],
    ['UInt16',   DataType.UInt16],
    ['UInt32',   DataType.UInt32],
    ['String',   DataType.String],
    ['DateTime', DataType.DateTime]
  ];

  cases.forEach(([name, expected]) => {
    it(`maps "${name}" → DataType.${name}`, () => {
      assert.strictEqual(resolveDataType(name), expected);
    });
  });

  it('returns DataType.Variant for unknown type name (safe fallback)', () => {
    assert.strictEqual(resolveDataType('UnknownType'), DataType.Variant);
  });

  it('returns DataType.Variant for undefined input', () => {
    assert.strictEqual(resolveDataType(undefined), DataType.Variant);
  });
});

// ── createVariableBinding ──────────────────────────────────────────────────────

describe('createVariableBinding()', () => {

  // ── Minimal namespace mock ───────────────────────────────────────────────
  // Captures the value.get / value.set closures so we can call them directly
  // in assertions, without starting a real OPC UA server.

  function makeMocks(contextData = {}) {
    let capturedValueConfig = null;

    const namespace = {
      addVariable(opts) {
        capturedValueConfig = opts.value;
        return { browseName: opts.browseName, _valueConfig: opts.value };
      },
      getCaptured() { return capturedValueConfig; }
    };

    const parentNode = {};

    const flowContext = {
      _store: { ...contextData },
      get(key)       { return this._store[key]; },
      set(key, val)  { this._store[key] = val; }
    };

    const sentMessages = [];
    const ownerNode = {
      send(msg) { sentMessages.push(msg); },
      getSent() { return sentMessages; }
    };

    return { namespace, parentNode, flowContext, ownerNode };
  }

  // ── browseName is forwarded ──────────────────────────────────────────────

  it('calls namespace.addVariable() with the configured browseName', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks();
    const config = { browseName: 'Temperature', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);

    const captured = namespace.getCaptured();
    assert.ok(captured !== null, 'addVariable must be called');
  });

  // ── getter ───────────────────────────────────────────────────────────────

  it('getter returns current flow context value as a Variant', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({ temp: 42.5 });
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().get();

    assert.ok(result instanceof Variant, 'get() must return a Variant');
    assert.strictEqual(result.value, 42.5, 'Variant value must match flow context');
  });

  it('getter returns defaultValue when contextKey is not set', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});  // empty context
    const config = {
      browseName:   'Temp',
      dataType:     'Double',
      contextKey:   'notSet',
      defaultValue: 0.0
    };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().get();

    assert.ok(result instanceof Variant);
    assert.strictEqual(result.value, 0.0, 'defaultValue must be returned when key is absent');
  });

  // ── setter ───────────────────────────────────────────────────────────────

  it('setter writes the variant value to flow context', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const incomingVariant = new Variant({ dataType: DataType.Double, value: 99.9 });
    namespace.getCaptured().set(incomingVariant);

    assert.strictEqual(flowContext._store['temp'], 99.9,
      'New value must be written into flow context');
  });

  it('setter returns StatusCodes.Good on success', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'X', dataType: 'Double', contextKey: 'x' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().set(new Variant({ dataType: DataType.Double, value: 1 }));

    assert.strictEqual(rc, StatusCodes.Good);
  });

  it('setter sends a message when triggerOnWrite is true', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = {
      browseName:    'Setpoint',
      dataType:      'Double',
      contextKey:    'sp',
      triggerOnWrite: true
    };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    namespace.getCaptured().set(new Variant({ dataType: DataType.Double, value: 55 }));

    const sent = ownerNode.getSent();
    assert.strictEqual(sent.length, 1, 'Exactly one message must be sent');
    assert.strictEqual(sent[0].payload, 55,       'msg.payload must be the written value');
    assert.strictEqual(sent[0].topic,   'Setpoint','msg.topic must be the browseName');
  });

  it('setter does NOT send a message when triggerOnWrite is false', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = {
      browseName:    'Setpoint',
      dataType:      'Double',
      contextKey:    'sp',
      triggerOnWrite: false
    };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    namespace.getCaptured().set(new Variant({ dataType: DataType.Double, value: 55 }));

    assert.strictEqual(ownerNode.getSent().length, 0,
      'No message must be sent when triggerOnWrite is false');
  });

  it('setter returns StatusCodes.BadInternalError when context.set() throws', () => {
    const { namespace, parentNode, ownerNode } = makeMocks({});
    const brokenContext = {
      get:  () => undefined,
      set:  () => { throw new Error('ContextUnavailable'); }
    };
    const config = { browseName: 'X', dataType: 'Double', contextKey: 'x' };

    createVariableBinding(namespace, parentNode, config, brokenContext, ownerNode);
    const rc = namespace.getCaptured().set(new Variant({ dataType: DataType.Double, value: 0 }));

    assert.strictEqual(rc, StatusCodes.BadInternalError,
      'Internal errors in setter must return BadInternalError — never crash the server');
  });

  it('setter returns StatusCodes.BadTypeMismatch when value type does not match variable data type', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().set(
      new Variant({ dataType: DataType.String, value: 'not-a-number' }) // TEST DATA
    );

    assert.strictEqual(rc, StatusCodes.BadTypeMismatch);
    assert.strictEqual(flowContext._store.temp, undefined, 'Context must not be updated on type mismatch');
  });
});

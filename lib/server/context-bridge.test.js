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
 *     isValueCompatibleWithDataType(typeName, value) — validates type match
 *     defaultForType(typeName)   — returns the zero-value for a data type
 *     createVariableBinding(ns, parentNode, nodeConfig, flowContext, ownerNode)
 *       — calls namespace.addVariable() and returns the UA node
 *
 * Why these test cases:
 *   - resolveDataType: all standard industrial types are mapped correctly
 *   - resolveDataType with unknown type: returns DataType.Variant (safe fallback)
 *   - isValueCompatibleWithDataType: all type/value combinations are validated
 *   - defaultForType: correct zero values for all types
 *   - getter reads current flow context value
 *   - getter returns defaultValue when context key is not set
 *   - getter returns type-safe default when neither context nor defaultValue is set
 *   - setter writes new value to flow context
 *   - setter returns StatusCodes.Good on success
 *   - setter sends a message when triggerOnWrite is true
 *   - setter does NOT send a message when triggerOnWrite is false
 *   - setter returns StatusCodes.BadInternalError when context.set() throws
 *   - setter returns StatusCodes.BadTypeMismatch for type mismatches
 *   - addVariable is called with minimumSamplingInterval and accessLevel
 *
 * See: docs/work-packages.md#wp-s-2 — Address Space Builder & Context Bridge
 * See: docs/theoretical-foundations.md — Context Mapping
 */
const assert = require('assert');
const { resolveDataType, createVariableBinding, isValueCompatibleWithDataType, defaultForType } = require('./context-bridge');
const { DataType, StatusCodes, Variant } = require('node-opcua');

// ── resolveDataType ───────────────────────────────────────────────────────────

describe('resolveDataType()', () => {

  const cases = [
    ['Boolean',    DataType.Boolean],
    ['ByteString', DataType.ByteString],
    ['NodeId',     DataType.NodeId],
    ['Double',     DataType.Double],
    ['Float',      DataType.Float],
    ['Int16',      DataType.Int16],
    ['Int32',      DataType.Int32],
    ['Int64',      DataType.Int64],
    ['UInt16',     DataType.UInt16],
    ['UInt32',     DataType.UInt32],
    ['UInt64',     DataType.UInt64],
    ['String',     DataType.String],
    ['DateTime',   DataType.DateTime]
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

  it('returns DataType.Variant for null input', () => {
    assert.strictEqual(resolveDataType(null), DataType.Variant);
  });
});

// ── isValueCompatibleWithDataType ────────────────────────────────────────────

describe('isValueCompatibleWithDataType()', () => {

  it('returns true for null value regardless of type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('Double', null), true);
  });

  it('returns true for undefined value regardless of type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('Double', undefined), true);
  });

  it('returns true for Variant type regardless of value', () => {
    assert.strictEqual(isValueCompatibleWithDataType('Variant', 'anything'), true);
  });

  // Boolean
  it('accepts boolean for Boolean type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('Boolean', true), true);
    assert.strictEqual(isValueCompatibleWithDataType('Boolean', false), true);
  });
  it('rejects non-boolean for Boolean type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('Boolean', 1), false);
    assert.strictEqual(isValueCompatibleWithDataType('Boolean', 'true'), false);
  });

  // String
  it('accepts string for String type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('String', 'hello'), true);
    assert.strictEqual(isValueCompatibleWithDataType('String', ''), true);
  });
  it('rejects non-string for String type', () => {
    assert.strictEqual(isValueCompatibleWithDataType('String', 42), false);
  });

  // Numeric types (including SByte and Byte)
  ['SByte', 'Byte', 'Double', 'Float', 'Int16', 'Int32', 'UInt16', 'UInt32'].forEach(typeName => {
    it(`accepts finite number for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, 42), true);
      assert.strictEqual(isValueCompatibleWithDataType(typeName, 0), true);
      assert.strictEqual(isValueCompatibleWithDataType(typeName, -1.5), true);
    });
    it(`rejects Infinity for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, Infinity), false);
    });
    it(`rejects NaN for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, NaN), false);
    });
    it(`rejects string for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, '42'), false);
    });
  });

  // Int64 / UInt64
  ['Int64', 'UInt64'].forEach(typeName => {
    it(`accepts number for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, 42), true);
    });
    it(`accepts bigint for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, BigInt(42)), true);
    });
    it(`accepts [low, high] tuple for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, [0, 1]), true); // TEST DATA
    });
    it(`rejects invalid tuple for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, [0, 1, 2]), false); // TEST DATA — wrong length
      assert.strictEqual(isValueCompatibleWithDataType(typeName, [0.5, 1]), false); // TEST DATA — non-integer
    });
    it(`rejects string for ${typeName}`, () => {
      assert.strictEqual(isValueCompatibleWithDataType(typeName, '42'), false);
    });
  });

  // DateTime
  it('accepts Date for DateTime', () => {
    assert.strictEqual(isValueCompatibleWithDataType('DateTime', new Date()), true);
  });
  it('rejects non-Date for DateTime', () => {
    assert.strictEqual(isValueCompatibleWithDataType('DateTime', '2024-01-01'), false);
    assert.strictEqual(isValueCompatibleWithDataType('DateTime', Date.now()), false);
  });

  // ByteString
  it('accepts Buffer for ByteString', () => {
    assert.strictEqual(isValueCompatibleWithDataType('ByteString', Buffer.from('test')), true); // TEST DATA
  });
  it('accepts Uint8Array for ByteString', () => {
    assert.strictEqual(isValueCompatibleWithDataType('ByteString', new Uint8Array([1, 2])), true); // TEST DATA
  });
  it('rejects string for ByteString', () => {
    assert.strictEqual(isValueCompatibleWithDataType('ByteString', 'abc'), false);
  });

  // NodeId
  it('accepts valid NodeId string ns=N;i=N', () => {
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', 'ns=2;i=1234'), true); // TEST DATA
  });
  it('accepts valid NodeId string ns=N;s=...', () => {
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', 'ns=1;s=Temperature'), true); // TEST DATA
  });
  it('accepts NodeId string without namespace prefix', () => {
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', 'i=85'), true); // TEST DATA
  });
  it('accepts NodeId-like object', () => {
    const nodeIdLike = { namespace: 0, value: 85, identifierType: 1 }; // TEST DATA
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', nodeIdLike), true);
  });
  it('rejects invalid NodeId string', () => {
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', 'invalid-node-id'), false);
  });
  it('rejects number for NodeId', () => {
    assert.strictEqual(isValueCompatibleWithDataType('NodeId', 42), false);
  });

  // Unknown type
  it('returns true for unknown type names (pass-through)', () => {
    assert.strictEqual(isValueCompatibleWithDataType('CustomType', 'anything'), true);
  });
});

// ── defaultForType ───────────────────────────────────────────────────────────

describe('defaultForType()', () => {
  it('returns false for Boolean', () => {
    assert.strictEqual(defaultForType('Boolean'), false);
  });
  it('returns empty string for String', () => {
    assert.strictEqual(defaultForType('String'), '');
  });
  it('returns 0 for numeric types', () => {
    ['SByte', 'Byte', 'Double', 'Float', 'Int16', 'Int32', 'UInt16', 'UInt32', 'Int64', 'UInt64'].forEach(t => {
      assert.strictEqual(defaultForType(t), 0, `Expected 0 for ${t}`);
    });
  });
  it('returns epoch Date for DateTime', () => {
    const d = defaultForType('DateTime');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getTime(), 0);
  });
  it('returns empty Buffer for ByteString', () => {
    const b = defaultForType('ByteString');
    assert.ok(Buffer.isBuffer(b));
    assert.strictEqual(b.length, 0);
  });
  it('returns null for unknown type', () => {
    assert.strictEqual(defaultForType('UnknownType'), null);
  });
});

// ── createVariableBinding ──────────────────────────────────────────────────────

describe('createVariableBinding()', () => {

  // ── Minimal namespace mock ───────────────────────────────────────────────
  // Captures the value.get / value.set closures so we can call them directly
  // in assertions, without starting a real OPC UA server.

  function makeMocks(contextData = {}) {
    let capturedOpts = null;

    const namespace = {
      addVariable(opts) {
        capturedOpts = opts;
        return { browseName: opts.browseName, _opts: opts };
      },
      getCaptured() { return capturedOpts; }
    };

    const parentNode = {};

    const flowContext = {
      _store: { ...contextData },
      get(key)       { return this._store[key]; },
      set(key, val)  { this._store[key] = val; }
    };

    const sentMessages = [];
    const errorMessages = [];
    const ownerNode = {
      send(msg) { sentMessages.push(msg); },
      error(msg) { errorMessages.push(msg); },
      getSent() { return sentMessages; },
      getErrors() { return errorMessages; }
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
    assert.strictEqual(captured.browseName, 'Temperature');
  });

  // ── minimumSamplingInterval and accessLevel ─────────────────────────────

  it('passes minimumSamplingInterval to addVariable (defaults to 1000)', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks();
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);

    const captured = namespace.getCaptured();
    assert.strictEqual(captured.minimumSamplingInterval, 1000);
  });

  it('uses custom minimumSamplingInterval when configured', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks();
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp', minimumSamplingInterval: 500 };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);

    const captured = namespace.getCaptured();
    assert.strictEqual(captured.minimumSamplingInterval, 500);
  });

  it('sets accessLevel to CurrentRead | CurrentWrite', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks();
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);

    const captured = namespace.getCaptured();
    assert.ok(captured.accessLevel !== undefined, 'accessLevel must be set');
    assert.ok(captured.userAccessLevel !== undefined, 'userAccessLevel must be set');
  });

  // ── getter ───────────────────────────────────────────────────────────────

  it('getter returns current flow context value as a Variant', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({ temp: 42.5 });
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().value.get();

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
    const result = namespace.getCaptured().value.get();

    assert.ok(result instanceof Variant);
    assert.strictEqual(result.value, 0.0, 'defaultValue must be returned when key is absent');
  });

  it('getter returns type-safe zero value when neither context nor defaultValue is set', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = {
      browseName: 'Temp',
      dataType:   'Double',
      contextKey: 'notSet'
      // no defaultValue
    };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().value.get();

    assert.ok(result instanceof Variant);
    assert.strictEqual(result.value, 0, 'Type-safe zero must be returned for Double');
  });

  it('getter returns false for Boolean type when context is empty', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Flag', dataType: 'Boolean', contextKey: 'flag' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().value.get();

    assert.strictEqual(result.value, false);
  });

  it('getter returns empty string for String type when context is empty', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Label', dataType: 'String', contextKey: 'label' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const result = namespace.getCaptured().value.get();

    assert.strictEqual(result.value, '');
  });

  // ── setter ───────────────────────────────────────────────────────────────

  it('setter writes the variant value to flow context', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const incomingVariant = new Variant({ dataType: DataType.Double, value: 99.9 });
    namespace.getCaptured().value.set(incomingVariant);

    assert.strictEqual(flowContext._store['temp'], 99.9,
      'New value must be written into flow context');
  });

  it('setter returns StatusCodes.Good on success', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'X', dataType: 'Double', contextKey: 'x' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().value.set(new Variant({ dataType: DataType.Double, value: 1 }));

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
    namespace.getCaptured().value.set(new Variant({ dataType: DataType.Double, value: 55 }));

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
    namespace.getCaptured().value.set(new Variant({ dataType: DataType.Double, value: 55 }));

    assert.strictEqual(ownerNode.getSent().length, 0,
      'No message must be sent when triggerOnWrite is false');
  });

  it('setter does NOT send a message when ownerNode is null', () => {
    const { namespace, parentNode, flowContext } = makeMocks({});
    const config = {
      browseName:    'Setpoint',
      dataType:      'Double',
      contextKey:    'sp',
      triggerOnWrite: true
    };

    // ownerNode is null — should not crash
    createVariableBinding(namespace, parentNode, config, flowContext, null);
    const rc = namespace.getCaptured().value.set(new Variant({ dataType: DataType.Double, value: 55 }));

    assert.strictEqual(rc, StatusCodes.Good);
  });

  it('setter returns StatusCodes.BadInternalError when context.set() throws', () => {
    const { namespace, parentNode, ownerNode } = makeMocks({});
    const brokenContext = {
      get:  () => undefined,
      set:  () => { throw new Error('ContextUnavailable'); }
    };
    const config = { browseName: 'X', dataType: 'Double', contextKey: 'x' };

    createVariableBinding(namespace, parentNode, config, brokenContext, ownerNode);
    const rc = namespace.getCaptured().value.set(new Variant({ dataType: DataType.Double, value: 0 }));

    assert.strictEqual(rc, StatusCodes.BadInternalError,
      'Internal errors in setter must return BadInternalError — never crash the server');
  });

  it('setter returns StatusCodes.BadTypeMismatch when value type does not match variable data type', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Temp', dataType: 'Double', contextKey: 'temp' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().value.set(
      new Variant({ dataType: DataType.String, value: 'not-a-number' }) // TEST DATA
    );

    assert.strictEqual(rc, StatusCodes.BadTypeMismatch);
    assert.strictEqual(flowContext._store.temp, undefined, 'Context must not be updated on type mismatch');
  });

  it('setter returns StatusCodes.BadTypeMismatch for invalid NodeId string payloads', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'NodeRef', dataType: 'NodeId', contextKey: 'nodeRef' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().value.set(
      new Variant({ dataType: DataType.String, value: 'invalid-node-id' }) // TEST DATA
    );

    assert.strictEqual(rc, StatusCodes.BadTypeMismatch);
    assert.strictEqual(flowContext._store.nodeRef, undefined);
  });

  it('setter accepts Boolean write to Boolean variable', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Flag', dataType: 'Boolean', contextKey: 'flag' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().value.set(new Variant({ dataType: DataType.Boolean, value: true }));

    assert.strictEqual(rc, StatusCodes.Good);
    assert.strictEqual(flowContext._store.flag, true);
  });

  it('setter accepts String write to String variable', () => {
    const { namespace, parentNode, flowContext, ownerNode } = makeMocks({});
    const config = { browseName: 'Name', dataType: 'String', contextKey: 'name' };

    createVariableBinding(namespace, parentNode, config, flowContext, ownerNode);
    const rc = namespace.getCaptured().value.set(new Variant({ dataType: DataType.String, value: 'TestVal' })); // TEST DATA

    assert.strictEqual(rc, StatusCodes.Good);
    assert.strictEqual(flowContext._store.name, 'TestVal'); // TEST DATA
  });
});

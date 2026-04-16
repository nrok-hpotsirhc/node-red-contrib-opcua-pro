'use strict';
/**
 * UDT Deserializer — Comprehensive Unit Tests
 * ============================================
 * What is tested here:
 *
 *   OPC UA servers transmit Extension Objects (UDTs) as opaque ByteString or
 *   as structured objects.  The deserializer must recursively convert them into
 *   plain JSON so that Node-RED flows can process them without any OPC UA
 *   knowledge.  msg.payload must always be a pure JS value.
 *
 * Why these test cases:
 *   - Null/undefined handling: avoid crashes for variables not yet set
 *   - Scalars (Boolean, Int32, Double, String, DateTime): direct passthrough
 *   - TypedArrays (Float32Array, Int32Array): must become plain JS Array
 *   - Empty array: valid edge case
 *   - Nested ExtensionObject: recursive decoding at arbitrary depth
 *   - Internal fields (_xxx): must be stripped from output
 *   - Mixed struct: UDT with nested objects AND TypedArray fields
 *   - normalizeDataValue: msg structure (payload + opcua metadata)
 *   - Bad status code: must appear in msg.opcua.statusCode, not throw
 *   - null statusCode: must not crash, defaults to 'Unknown'
 *
 * See: docs/work-packages.md#wp-c-35-udt-deserializer
 * See: docs/theoretical-foundations.md#8 — Extension Objects und UDTs
 */
const assert = require('assert');
const { deserializeValue, normalizeDataValue } = require('./udt-deserializer');
const { Variant, DataType, VariantArrayType } = require('node-opcua');

describe('UDT Deserializer', () => {

  // ── Null / empty ───────────────────────────────────────────────────────────

  it('returns null for null variant', () => {
    assert.strictEqual(deserializeValue(null), null);
  });

  it('returns null for undefined variant', () => {
    assert.strictEqual(deserializeValue(undefined), null);
  });

  it('returns null for Null DataType variant', () => {
    const v = { dataType: DataType.Null, arrayType: VariantArrayType.Scalar, value: null };
    assert.strictEqual(deserializeValue(v), null);
  });

  // ── Scalar types ──────────────────────────────────────────────────────────

  it('passes through Double scalar unchanged', () => {
    const v = new Variant({ dataType: DataType.Double, value: 42.5 });
    assert.strictEqual(deserializeValue(v), 42.5);
  });

  it('passes through Boolean scalar unchanged', () => {
    const v = new Variant({ dataType: DataType.Boolean, value: true });
    assert.strictEqual(deserializeValue(v), true);
  });

  it('passes through Int32 scalar unchanged', () => {
    const v = new Variant({ dataType: DataType.Int32, value: -99 });
    assert.strictEqual(deserializeValue(v), -99);
  });

  it('passes through String scalar unchanged', () => {
    const v = new Variant({ dataType: DataType.String, value: 'Running' });
    assert.strictEqual(deserializeValue(v), 'Running');
  });

  it('passes through DateTime scalar unchanged (Date instance)', () => {
    const d = new Date('2025-01-01T00:00:00Z');
    const v = new Variant({ dataType: DataType.DateTime, value: d });
    assert.strictEqual(deserializeValue(v), d);
  });

  // ── TypedArray → plain JS Array ───────────────────────────────────────────

  it('converts Float32Array to plain JS Array with correct values', () => {
    const v = {
      dataType:  DataType.Float,
      arrayType: VariantArrayType.Array,
      value:     new Float32Array([1.0, 2.0, 3.0])
    };
    const result = deserializeValue(v);
    assert.ok(Array.isArray(result), 'Result must be a plain Array');
    assert.strictEqual(result.length, 3);
    assert.ok(Math.abs(result[0] - 1.0) < 0.001);
    assert.ok(Math.abs(result[1] - 2.0) < 0.001);
    assert.ok(Math.abs(result[2] - 3.0) < 0.001);
  });

  it('converts Int32Array to plain JS Array', () => {
    const v = {
      dataType:  DataType.Int32,
      arrayType: VariantArrayType.Array,
      value:     new Int32Array([10, 20, 30])
    };
    const result = deserializeValue(v);
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, [10, 20, 30]);
  });

  it('converts empty TypedArray to empty plain JS Array', () => {
    const v = {
      dataType:  DataType.Float,
      arrayType: VariantArrayType.Array,
      value:     new Float32Array([])
    };
    const result = deserializeValue(v);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  it('returns empty array when variant.value is null for array type', () => {
    const v = { dataType: DataType.Double, arrayType: VariantArrayType.Array, value: null };
    const result = deserializeValue(v);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  // ── Extension Objects (UDTs) ──────────────────────────────────────────────

  it('deserializes a flat ExtensionObject into a plain JS object', () => {
    const v = {
      dataType:  DataType.ExtensionObject,
      arrayType: VariantArrayType.Scalar,
      value:     { temperature: 23.5, humidity: 60 }
    };
    const result = deserializeValue(v);
    assert.deepStrictEqual(result, { temperature: 23.5, humidity: 60 },
      'Result must be a plain object with the same properties');
    assert.strictEqual(Object.prototype.toString.call(result), '[object Object]',
      'Result must be a plain Object, not a special class instance');
  });

  it('strips internal _xxx fields from ExtensionObject', () => {
    const v = {
      dataType:  DataType.ExtensionObject,
      arrayType: VariantArrayType.Scalar,
      value:     { temperature: 23.5, _schema: 'secret', _typeId: 42 } // TEST DATA — internal OPC UA fields that must be stripped
    };
    const result = deserializeValue(v);
    assert.strictEqual(result.temperature, 23.5);
    assert.strictEqual(result._schema,     undefined, '_schema must be stripped');
    assert.strictEqual(result._typeId,     undefined, '_typeId must be stripped');
  });

  it('recursively decodes nested ExtensionObjects', () => {
    const v = {
      dataType:  DataType.ExtensionObject,
      arrayType: VariantArrayType.Scalar,
      value:     {
        motor: { rpm: 3000, torque: 12.5 },
        status: 'Active'
      }
    };
    const result = deserializeValue(v);
    assert.strictEqual(result.motor.rpm,    3000);
    assert.strictEqual(result.motor.torque, 12.5);
    assert.strictEqual(result.status,       'Active');
  });

  it('converts TypedArray within a nested UDT struct to plain JS Array', () => {
    const v = {
      dataType:  DataType.ExtensionObject,
      arrayType: VariantArrayType.Scalar,
      value:     {
        name:    'Sensor',
        samples: new Float32Array([1.1, 2.2, 3.3])
      }
    };
    const result = deserializeValue(v);
    assert.strictEqual(result.name,      'Sensor');
    assert.ok(Array.isArray(result.samples), 'Nested TypedArray must become plain Array');
    assert.strictEqual(result.samples.length, 3);
  });

  it('passes through Date values inside ExtensionObject without converting them', () => {
    const d = new Date('2025-06-01');
    const v = {
      dataType:  DataType.ExtensionObject,
      arrayType: VariantArrayType.Scalar,
      value:     { timestamp: d, value: 99 }
    };
    const result = deserializeValue(v);
    assert.strictEqual(result.timestamp, d, 'Date instances must pass through unchanged');
  });

  it('deserializeExtensionObject handles null gracefully', () => {
    const { deserializeExtensionObject } = require('./udt-deserializer');
    assert.strictEqual(deserializeExtensionObject(null), null);
  });

  it('deserializeExtensionObject on a primitive returns it unchanged', () => {
    const { deserializeExtensionObject } = require('./udt-deserializer');
    assert.strictEqual(deserializeExtensionObject(42), 42);
  });

  // ── normalizeDataValue → msg structure ────────────────────────────────────

  it('normalizeDataValue produces correct msg.payload and msg.opcua structure', () => {
    const dataValue = {
      value:           new Variant({ dataType: DataType.Double, value: 100.0 }),
      statusCode:      { name: 'Good' },
      sourceTimestamp: new Date('2025-01-01'),
      serverTimestamp: new Date('2025-01-01')
    };
    const msg = normalizeDataValue(dataValue, 'ns=2;s=Temperature');

    assert.strictEqual(msg.payload,                100.0,     'payload must equal the scalar value');
    assert.strictEqual(msg.opcua.statusCode,       'Good',    'statusCode name must be forwarded');
    assert.strictEqual(msg.opcua.nodeId,           'ns=2;s=Temperature');
    assert.ok(msg.opcua.sourceTimestamp instanceof Date, 'sourceTimestamp must be a Date');
    assert.ok(msg.opcua.serverTimestamp instanceof Date, 'serverTimestamp must be a Date');
    assert.ok('dataType' in msg.opcua, 'msg.opcua.dataType must be present');
  });

  it('normalizeDataValue with Bad status code propagates "Bad" string', () => {
    const dataValue = {
      value:      new Variant({ dataType: DataType.Double, value: 0 }),
      statusCode: { name: 'BadNoCommunication' }
    };
    const msg = normalizeDataValue(dataValue, 'ns=2;s=X');
    assert.strictEqual(msg.opcua.statusCode, 'BadNoCommunication');
  });

  it('normalizeDataValue with null statusCode falls back to "Unknown"', () => {
    const dataValue = {
      value:      new Variant({ dataType: DataType.Double, value: 0 }),
      statusCode: null
    };
    const msg = normalizeDataValue(dataValue, 'ns=2;s=X');
    assert.strictEqual(msg.opcua.statusCode, 'Unknown');
  });

  it('normalizeDataValue with missing timestamps stores null', () => {
    const dataValue = {
      value:           new Variant({ dataType: DataType.Double, value: 0 }),
      statusCode:      { name: 'Good' },
      sourceTimestamp: undefined,
      serverTimestamp: undefined
    };
    const msg = normalizeDataValue(dataValue, 'ns=2;s=X');
    assert.strictEqual(msg.opcua.sourceTimestamp, null);
    assert.strictEqual(msg.opcua.serverTimestamp, null);
  });
});

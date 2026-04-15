'use strict';
// WP-C-3: udt-deserializer unit tests
const assert = require('assert');
const { deserializeValue, normalizeDataValue } = require('../../lib/client/udt-deserializer');
const { Variant, DataType, VariantArrayType, StatusCodes } = require('node-opcua');

describe('UDT Deserializer', () => {
  it('returns null for null variant', () => {
    assert.strictEqual(deserializeValue(null), null);
  });

  it('returns scalar value directly', () => {
    const v = new Variant({ dataType: DataType.Double, value: 42.5 });
    assert.strictEqual(deserializeValue(v), 42.5);
  });

  it('converts Float32Array to plain JS array', () => {
    const v = {
      dataType:  DataType.Float,
      arrayType: VariantArrayType.Array,
      value:     new Float32Array([1.1, 2.2, 3.3])
    };
    const result = deserializeValue(v);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  });

  it('normalizeDataValue sets msg.payload and msg.opcua correctly', () => {
    const dataValue = {
      value:           new Variant({ dataType: DataType.Double, value: 100.0 }),
      statusCode:      { name: 'Good' },
      sourceTimestamp: new Date('2025-01-01'),
      serverTimestamp: new Date('2025-01-01')
    };

    const msg = normalizeDataValue(dataValue, 'ns=2;s=Temperature');

    assert.strictEqual(msg.payload, 100.0);
    assert.strictEqual(msg.opcua.statusCode, 'Good');
    assert.strictEqual(msg.opcua.nodeId, 'ns=2;s=Temperature');
    assert.ok(msg.opcua.sourceTimestamp instanceof Date);
  });
});

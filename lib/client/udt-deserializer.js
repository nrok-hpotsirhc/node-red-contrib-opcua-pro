'use strict';
// WP-C-3: udt-deserializer — Recursive Extension Object decoder
// See: docs/work-packages.md#wp-c-3-wp-c-35-udt-deserializer
// See: docs/theoretical-foundations.md#8-extension-objects-und-user-defined-types-udts

const { DataType, VariantArrayType } = require('node-opcua');

function deserializeValue(variant) {
  if (!variant || variant.dataType === DataType.Null) return null;

  if (variant.arrayType !== VariantArrayType.Scalar) {
    // TypedArray (Float32Array, Int32Array, etc.) → plain JS Array
    return Array.from(variant.value ?? []);
  }

  if (variant.dataType === DataType.ExtensionObject) {
    return deserializeExtensionObject(variant.value);
  }

  return variant.value;
}

function deserializeExtensionObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // TypedArray within a structure
  if (ArrayBuffer.isView(obj)) return Array.from(obj);

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('_')) continue; // Skip internal OPC UA fields
    if (ArrayBuffer.isView(val)) {
      result[key] = Array.from(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      result[key] = deserializeExtensionObject(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function normalizeDataValue(dataValue, nodeId) {
  return {
    payload: deserializeValue(dataValue.value),
    opcua: {
      nodeId:          nodeId,
      statusCode:      dataValue.statusCode?.name ?? 'Unknown',
      sourceTimestamp: dataValue.sourceTimestamp ?? null,
      serverTimestamp: dataValue.serverTimestamp ?? null,
      dataType:        dataValue.value?.dataType
    }
  };
}

module.exports = { deserializeValue, deserializeExtensionObject, normalizeDataValue };

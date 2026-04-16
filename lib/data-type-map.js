'use strict';
// Shared OPC UA DataType name → enum mapping.
// Single source of truth used by both client (opcua-write) and server (context-bridge).

const { DataType } = require('node-opcua');

const DATA_TYPE_MAP = Object.freeze({
  Boolean:    DataType.Boolean,
  SByte:      DataType.SByte,
  Byte:       DataType.Byte,
  Int16:      DataType.Int16,
  UInt16:     DataType.UInt16,
  Int32:      DataType.Int32,
  UInt32:     DataType.UInt32,
  Int64:      DataType.Int64,
  UInt64:     DataType.UInt64,
  Float:      DataType.Float,
  Double:     DataType.Double,
  String:     DataType.String,
  DateTime:   DataType.DateTime,
  ByteString: DataType.ByteString,
  NodeId:     DataType.NodeId
});

function resolveDataType(typeName) {
  return DATA_TYPE_MAP[typeName] ?? DataType.Variant;
}

module.exports = { DATA_TYPE_MAP, resolveDataType };

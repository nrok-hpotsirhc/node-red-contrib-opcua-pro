'use strict';
// WP-S-2: context-bridge — Bidirectional data link between OPC UA variables and Node-RED context
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge
// See: docs/theoretical-foundations.md#context-mapping-die-bidirektionale-datenbrücke

const { Variant, DataType, StatusCodes, AccessLevelFlag } = require('node-opcua');

const DATA_TYPE_MAP = {
  'Boolean':    DataType.Boolean,
  'ByteString': DataType.ByteString,
  'NodeId':     DataType.NodeId,
  'Double':     DataType.Double,
  'Float':      DataType.Float,
  'Int16':      DataType.Int16,
  'Int32':      DataType.Int32,
  'Int64':      DataType.Int64,
  'UInt16':     DataType.UInt16,
  'UInt32':     DataType.UInt32,
  'UInt64':     DataType.UInt64,
  'String':     DataType.String,
  'DateTime':   DataType.DateTime
};

function resolveDataType(typeName) {
  return DATA_TYPE_MAP[typeName] ?? DataType.Variant;
}

// Type checking helpers — defined at module scope to avoid re-allocation on every call.
const isInt64Tuple = (tuple) =>
  Array.isArray(tuple) && tuple.length === 2 && tuple.every(item => Number.isInteger(item));

const isNodeIdLikeObject = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.constructor?.name === 'NodeId') return true;
  const hasNamespace = Number.isInteger(candidate.namespace) && candidate.namespace >= 0;
  const hasValue = Object.prototype.hasOwnProperty.call(candidate, 'value');
  const hasIdentifierType = Object.prototype.hasOwnProperty.call(candidate, 'identifierType');
  return hasNamespace && hasValue && hasIdentifierType;
};

const isNodeIdString = (candidate) =>
  /^(ns=\d+;)?(i=\d+|s=[^;]+|g=[0-9a-fA-F-]{36}|b=[^;]+)$/.test(candidate);

function isValueCompatibleWithDataType(typeName, value) {
  if (value === null || value === undefined || typeName === 'Variant') {
    return true;
  }

  switch (typeName) {
  case 'Boolean': return typeof value === 'boolean';
  case 'String': return typeof value === 'string';
  case 'Double':
  case 'Float':
  case 'Int16':
  case 'Int32':
  case 'UInt16':
  case 'UInt32':
    return typeof value === 'number' && Number.isFinite(value);
  case 'Int64':
  case 'UInt64':
    return typeof value === 'number' || typeof value === 'bigint' || isInt64Tuple(value);
  case 'DateTime':
    return value instanceof Date;
  case 'ByteString':
    return Buffer.isBuffer(value) || value instanceof Uint8Array;
  case 'NodeId':
    return (typeof value === 'string' && isNodeIdString(value)) || isNodeIdLikeObject(value);
  default:
    return true;
  }
}

/**
 * Returns the default "zero" value for a given OPC UA data type name.
 * Used when neither the flow context nor the node config provides a value.
 */
function defaultForType(typeName) {
  switch (typeName) {
  case 'Boolean':    return false;
  case 'String':     return '';
  case 'Double':
  case 'Float':
  case 'Int16':
  case 'Int32':
  case 'UInt16':
  case 'UInt32':     return 0;
  case 'Int64':
  case 'UInt64':     return 0;
  case 'DateTime':   return new Date(0);
  case 'ByteString': return Buffer.alloc(0);
  default:           return null;
  }
}

function createVariableBinding(namespace, parentNode, nodeConfig, flowContext, ownerNode) {
  const dataType = resolveDataType(nodeConfig.dataType);
  const typeDefault = defaultForType(nodeConfig.dataType);

  return namespace.addVariable({
    nodeId: nodeConfig.nodeId || undefined,
    componentOf: parentNode,
    browseName:  nodeConfig.browseName,
    dataType:    nodeConfig.dataType,
    minimumSamplingInterval: nodeConfig.minimumSamplingInterval ?? 1000,
    accessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite,
    userAccessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite,
    value: {
      get: () => {
        const raw = flowContext.get(nodeConfig.contextKey);
        // Note: ?? (nullish coalescing) is intentional here — falsy values like
        // 0, false, and '' are valid OPC UA data and must NOT fall through to defaults.
        const value = raw ?? nodeConfig.defaultValue ?? typeDefault;
        return new Variant({ dataType, value });
      },
      set: (variant) => {
        try {
          if (!isValueCompatibleWithDataType(nodeConfig.dataType, variant.value)) {
            return StatusCodes.BadTypeMismatch;
          }
          flowContext.set(nodeConfig.contextKey, variant.value);
          if (nodeConfig.triggerOnWrite && ownerNode) {
            ownerNode.send({
              payload: variant.value,
              topic:   nodeConfig.browseName
            });
          }
          return StatusCodes.Good;
        } catch (err) {
          return StatusCodes.BadInternalError;
        }
      }
    }
  });
}

module.exports = { createVariableBinding, resolveDataType, isValueCompatibleWithDataType, defaultForType };

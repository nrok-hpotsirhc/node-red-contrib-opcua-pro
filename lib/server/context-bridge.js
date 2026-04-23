'use strict';
// WP-S-2: context-bridge — Bidirectional data link between OPC UA variables and Node-RED context
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge
// See: docs/theoretical-foundations.md#context-mapping-die-bidirektionale-datenbrücke

const { Variant, StatusCodes, AccessLevelFlag } = require('node-opcua');
const { resolveDataType } = require('../data-type-map');

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
  case 'SByte':
  case 'Byte':
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
  case 'SByte':
  case 'Byte':
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

/**
 * Parse a Node-RED access-level config value into an AccessLevelFlag bitmap.
 * Accepts either a number (already a bitmap), a string "CurrentRead|CurrentWrite"
 * (also ',' or ' ' as separator), or an array of flag names. Unknown names
 * are silently ignored. Returns `fallback` when the spec resolves to 0.
 */
function parseAccessLevel(spec, fallback) {
  if (spec === null || spec === undefined || spec === '') return fallback;
  if (typeof spec === 'number' && Number.isFinite(spec)) return spec;
  const parts = Array.isArray(spec)
    ? spec
    : String(spec).split(/[|,\s]+/).filter(Boolean);
  let flags = 0;
  for (const name of parts) {
    const flagValue = AccessLevelFlag[name];
    if (typeof flagValue === 'number') flags |= flagValue;
  }
  return flags || fallback;
}

/**
 * Attach an EURange property to an Analog variable.
 * Uses a simple numeric low/high pair; the property is created as a standard
 * OPC UA Range ExtensionObject via node-opcua's Range type resolution.
 */
function attachEURange(namespace, variable, euRange) {
  if (!euRange) return;
  const low  = Number(euRange.low);
  const high = Number(euRange.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return;
  try {
    namespace.addVariable({
      propertyOf: variable,
      browseName: 'EURange',
      dataType:   'Range',
      value: { get: () => new Variant({ dataType: 'ExtensionObject', value: { low, high } }) }
    });
  } catch {
    // Range type may not be available in minimal test doubles — non-fatal.
  }
}

/**
 * Attach an EngineeringUnits property. `units` can be either a string
 * (interpreted as displayName) or an EUInformation-shaped object.
 */
function attachEngineeringUnits(namespace, variable, units) {
  if (!units) return;
  const info = typeof units === 'string'
    ? { displayName: units, description: units, namespaceUri: 'http://www.opcfoundation.org/UA/units/un/cefact', unitId: 0 }
    : {
        displayName:  units.displayName  || '',
        description:  units.description  || units.displayName || '',
        namespaceUri: units.namespaceUri || 'http://www.opcfoundation.org/UA/units/un/cefact',
        unitId:       Number.isFinite(units.unitId) ? units.unitId : 0
      };
  try {
    namespace.addVariable({
      propertyOf: variable,
      browseName: 'EngineeringUnits',
      dataType:   'EUInformation',
      value: { get: () => new Variant({ dataType: 'ExtensionObject', value: info }) }
    });
  } catch {
    // Non-fatal — see attachEURange.
  }
}

function createVariableBinding(namespace, parentNode, nodeConfig, flowContext, ownerNode) {
  const dataType = resolveDataType(nodeConfig.dataType);
  const typeDefault = defaultForType(nodeConfig.dataType);

  const defaultAccess = AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite;
  let accessLevel     = parseAccessLevel(nodeConfig.accessLevel,     defaultAccess);
  let userAccessLevel = parseAccessLevel(nodeConfig.userAccessLevel, accessLevel);

  // Historizing implies HistoryRead in the access level bitmap (per OPC UA spec).
  if (nodeConfig.historizing) {
    accessLevel     |= AccessLevelFlag.HistoryRead;
    userAccessLevel |= AccessLevelFlag.HistoryRead;
  }

  const writeAllowed     = (accessLevel     & AccessLevelFlag.CurrentWrite) !== 0;
  const userWriteAllowed = (userAccessLevel & AccessLevelFlag.CurrentWrite) !== 0;

  const variableOptions = {
    nodeId: nodeConfig.nodeId || undefined,
    componentOf: parentNode,
    browseName:  nodeConfig.browseName,
    dataType:    nodeConfig.dataType,
    description: nodeConfig.description || undefined,
    minimumSamplingInterval: nodeConfig.minimumSamplingInterval ?? 1000,
    accessLevel,
    userAccessLevel,
    historizing: Boolean(nodeConfig.historizing),
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
          if (!writeAllowed || !userWriteAllowed) {
            return StatusCodes.BadUserAccessDenied;
          }
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
          if (ownerNode) ownerNode.error(`Context write failed: ${err.message}`);
          return StatusCodes.BadInternalError;
        }
      }
    }
  };

  // Optional array shape (valueRank >= 1 signals an array; -1 = Scalar, 0 = OneOrMoreDimensions).
  if (nodeConfig.valueRank !== undefined && nodeConfig.valueRank !== null && nodeConfig.valueRank !== '') {
    const rank = Number(nodeConfig.valueRank);
    if (Number.isFinite(rank)) variableOptions.valueRank = rank;
  }
  if (Array.isArray(nodeConfig.arrayDimensions) && nodeConfig.arrayDimensions.length > 0) {
    variableOptions.arrayDimensions = nodeConfig.arrayDimensions.map(n => Number(n) || 0);
  }

  const variable = namespace.addVariable(variableOptions);

  attachEURange(namespace, variable, nodeConfig.euRange);
  attachEngineeringUnits(namespace, variable, nodeConfig.engineeringUnits);

  return variable;
}

module.exports = {
  createVariableBinding,
  resolveDataType,
  isValueCompatibleWithDataType,
  defaultForType,
  parseAccessLevel
};

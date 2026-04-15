'use strict';
// WP-S-2: context-bridge — Bidirectional data link between OPC UA variables and Node-RED context
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge
// See: docs/theoretical-foundations.md#context-mapping-die-bidirektionale-datenbrücke

const { Variant, DataType, StatusCodes } = require('node-opcua');

const DATA_TYPE_MAP = {
  'Boolean': DataType.Boolean,
  'Double':  DataType.Double,
  'Float':   DataType.Float,
  'Int16':   DataType.Int16,
  'Int32':   DataType.Int32,
  'Int64':   DataType.Int64,
  'UInt16':  DataType.UInt16,
  'UInt32':  DataType.UInt32,
  'String':  DataType.String,
  'DateTime':DataType.DateTime
};

function resolveDataType(typeName) {
  return DATA_TYPE_MAP[typeName] ?? DataType.Variant;
}

function createVariableBinding(namespace, parentNode, nodeConfig, flowContext, ownerNode) {
  const dataType = resolveDataType(nodeConfig.dataType);

  return namespace.addVariable({
    componentOf: parentNode,
    browseName:  nodeConfig.browseName,
    dataType:    nodeConfig.dataType,
    value: {
      get: () => {
        const raw = flowContext.get(nodeConfig.contextKey);
        return new Variant({ dataType, value: raw ?? nodeConfig.defaultValue ?? null });
      },
      set: (variant) => {
        try {
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

module.exports = { createVariableBinding, resolveDataType };

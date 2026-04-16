'use strict';
// WP-S-4 (M4): opcua-server-method — Server-side RPC method trigger node
// See: docs/work-packages.md#wp-s-4-rpc-methoden--event-handling
// See: docs/theoretical-foundations.md#7-methods-und-remote-procedure-calls

const crypto = require('crypto');
const { DataType, Variant, StatusCodes } = require('node-opcua');

/**
 * Parse argument definitions from config string.
 * Expected format: JSON array of { name, dataType } objects.
 * Returns an array suitable for namespace.addMethod inputArguments/outputArguments.
 */
function parseArgumentDefs(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(arg => {
      const resolvedType = DataType[arg.dataType];
      return {
        name:        String(arg.name || ''),
        description: arg.description || '',
        dataType:    resolvedType !== undefined ? resolvedType : DataType.Variant
      };
    });
  } catch (_) {
    return [];
  }
}

module.exports = function (RED) {
  function OpcuaServerMethod(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Correlation table: UUID → { resolve, reject, timeout }
    node.pendingCalls = new Map();

    node.serverConfig = RED.nodes.getNode(config.server);
    if (!node.serverConfig) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      return;
    }

    const methodName = config.methodName;
    if (!methodName) {
      node.status({ fill: 'red', shape: 'ring', text: 'No method name' });
      return;
    }

    const timeoutMs = parseInt(config.timeoutMs, 10) || 10000;

    const setupMethod = (addressSpace) => {
      if (node.method) return;
      if (!addressSpace) {
        node.error('Address space is not available');
        node.status({ fill: 'red', shape: 'ring', text: 'No address space' });
        return;
      }

      try {
        const namespace = addressSpace.getOwnNamespace();

        // Resolve parent object — from config or default to Objects folder
        let parentObject;
        if (config.parentNodeId) {
          parentObject = addressSpace.findNode(config.parentNodeId);
        }
        if (!parentObject) {
          parentObject = addressSpace.rootFolder.objects;
        }

        const inputArgumentDefs = parseArgumentDefs(config.inputArguments);
        const outputArgumentDefs = parseArgumentDefs(config.outputArguments);

        const method = namespace.addMethod(parentObject, {
          browseName:      methodName,
          nodeId:          config.nodeId || undefined,
          inputArguments:  inputArgumentDefs,
          outputArguments: outputArgumentDefs
        });

        method.bindMethod((inputArguments, _context, callback) => {
          const correlationId = crypto.randomUUID();

          const timeout = setTimeout(() => {
            const pending = node.pendingCalls.get(correlationId);
            if (pending) {
              node.pendingCalls.delete(correlationId);
              callback(null, {
                statusCode: StatusCodes.BadTimeout,
                outputArguments: []
              });
            }
          }, timeoutMs);

          node.pendingCalls.set(correlationId, {
            resolve: (outputValues) => {
              // Convert plain values to Variant array
              const outputArgs = Array.isArray(outputValues)
                ? outputValues.map(v => {
                  if (v && typeof v === 'object' && v.dataType !== undefined && v.value !== undefined) {
                    return new Variant(v);
                  }
                  return new Variant({ dataType: DataType.Variant, value: v });
                })
                : [];
              callback(null, {
                statusCode: StatusCodes.Good,
                outputArguments: outputArgs
              });
            },
            reject: (err) => {
              callback(err, {
                statusCode: StatusCodes.BadInternalError,
                outputArguments: []
              });
            },
            timeout
          });

          // Emit msg into the flow with correlation ID
          const args = (inputArguments || []).map(a =>
            (a && typeof a === 'object' && a.value !== undefined) ? a.value : a
          );
          node.send({
            payload:          args,
            _opcua_method_id: correlationId,
            topic:            methodName
          });
        });

        node.method = method;
        node.status({ fill: 'green', shape: 'dot', text: methodName });
      } catch (err) {
        node.error(`Failed to register method: ${err.message}`);
        node.status({ fill: 'red', shape: 'dot', text: `Error: ${err.message}` });
      }
    };

    node.serverConfig.on('addressSpaceReady', setupMethod);
    if (node.serverConfig.addressSpace) {
      setupMethod(node.serverConfig.addressSpace);
    }

    node.on('close', (_removed, done) => {
      node.serverConfig.removeListener('addressSpaceReady', setupMethod);
      // Clean up pending calls to prevent memory leaks
      for (const [, pending] of node.pendingCalls) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Node closed'));
      }
      node.pendingCalls.clear();
      done();
    });
  }

  RED.nodes.registerType('opcua-server-method', OpcuaServerMethod);
};

'use strict';
// WP-C-6: mock-server — Reusable OPC UA test server fixture
// See: docs/work-packages.md#wp-c-6-cicd--dokumentation

const { OPCUAServer, Variant, DataType, StatusCodes } = require('node-opcua');

async function createMockServer(port = 4841) {
  const server = new OPCUAServer({
    port,
    resourcePath: '/test',
    buildInfo: { productName: 'NodeRED-OpcUA-MockServer' }
  });

  await server.initialize();

  const addressSpace = server.engine.addressSpace;
  const namespace    = addressSpace.getOwnNamespace();
  const objects      = addressSpace.rootFolder.objects;

  // Mutable state for test scenarios
  const state = {
    temperature: 23.5,
    pressure:    1.013,
    deviceStatus: 'Running'
  };

  // Scalar Double variable
  namespace.addVariable({
    nodeId:      'ns=1;s=Temperature',   // Explicit string NodeId for test predictability
    organizedBy: objects,
    browseName:  'Temperature',
    dataType:    'Double',
    minimumSamplingInterval: 1000,
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: state.temperature }),
      set: (v) => { state.temperature = v.value; return StatusCodes.Good; }
    }
  });

  // Scalar Double variable
  namespace.addVariable({
    nodeId:      'ns=1;s=Pressure',
    organizedBy: objects,
    browseName:  'Pressure',
    dataType:    'Double',
    minimumSamplingInterval: 1000,
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: state.pressure }),
      set: (v) => { state.pressure = v.value; return StatusCodes.Good; }
    }
  });

  // String variable
  namespace.addVariable({
    nodeId:      'ns=1;s=DeviceStatus',
    organizedBy: objects,
    browseName:  'DeviceStatus',
    dataType:    'String',
    minimumSamplingInterval: 1000,
    value: {
      get: () => new Variant({ dataType: DataType.String, value: state.deviceStatus })
    }
  });

  await server.start();

  const endpointUrl = server.getEndpointUrl();

  return {
    server,
    endpointUrl,
    state,               // Expose for test manipulation
    stop: () => server.shutdown(500)
  };
}

module.exports = { createMockServer };

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

  // ── RPC Methods for WP-S-4 / M4 testing ───────────────────────────────────

  // Create a device object to hold methods (OPC UA requires methods on Objects, not the Objects folder)
  const deviceObject = namespace.addObject({
    organizedBy: objects,
    browseName:  'TestDevice',
    nodeId:      'ns=1;s=TestDevice'
  });

  // Simple Add method: takes two Doubles, returns their sum
  const addMethod = namespace.addMethod(deviceObject, {
    nodeId:      'ns=1;s=AddMethod',
    browseName:  'Add',
    inputArguments: [
      { name: 'a', description: 'First operand',  dataType: DataType.Double },
      { name: 'b', description: 'Second operand', dataType: DataType.Double }
    ],
    outputArguments: [
      { name: 'sum', description: 'Sum of a and b', dataType: DataType.Double }
    ]
  });

  addMethod.bindMethod((inputArguments, context, callback) => {
    const a = inputArguments[0].value;
    const b = inputArguments[1].value;
    const sum = a + b;
    callback(null, {
      statusCode: StatusCodes.Good,
      outputArguments: [new Variant({ dataType: DataType.Double, value: sum })]
    });
  });

  // Echo method: takes a String, returns it back — for testing String handling
  const echoMethod = namespace.addMethod(deviceObject, {
    nodeId:      'ns=1;s=EchoMethod',
    browseName:  'Echo',
    inputArguments: [
      { name: 'message', description: 'Message to echo', dataType: DataType.String }
    ],
    outputArguments: [
      { name: 'echo', description: 'Echoed message', dataType: DataType.String }
    ]
  });

  echoMethod.bindMethod((inputArguments, context, callback) => {
    const message = inputArguments[0].value;
    callback(null, {
      statusCode: StatusCodes.Good,
      outputArguments: [new Variant({ dataType: DataType.String, value: message })]
    });
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

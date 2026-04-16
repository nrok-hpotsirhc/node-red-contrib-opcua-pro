'use strict';
// WP-C-3 (Method) + WP-S-4: Integration test — Method Call end-to-end
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/work-packages.md#wp-s-4-rpc-methoden--event-handling

const assert = require('assert');
const { OPCUAClient, DataType, Variant } = require('node-opcua');
const { createMockServer } = require('../fixtures/mock-server');

describe('Method Call (Integration)', () => {

  it('calls Add method and receives correct sum', async function () {
    this.timeout(15000);
    const { endpointUrl, stop } = await createMockServer(4850);

    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 }
    });

    try {
      await client.connect(endpointUrl);
      const session = await client.createSession();

      // Call Add(10.5, 20.3) — expects sum = 30.8
      const callResult = await session.call({
        objectId:  'ns=1;s=TestDevice',
        methodId:  'ns=1;s=AddMethod',
        inputArguments: [
          new Variant({ dataType: DataType.Double, value: 10.5 }), // TEST DATA
          new Variant({ dataType: DataType.Double, value: 20.3 })  // TEST DATA
        ]
      });

      assert.ok(callResult.statusCode.isGood(), 'Method call status must be Good');
      assert.strictEqual(callResult.outputArguments.length, 1);
      assert.ok(
        Math.abs(callResult.outputArguments[0].value - 30.8) < 0.001,
        `Expected sum ≈ 30.8, got ${callResult.outputArguments[0].value}`
      );

      await session.close();
      await client.disconnect();
    } finally {
      await stop();
    }
  });

  it('calls Echo method and receives echoed string', async function () {
    this.timeout(15000);
    const { endpointUrl, stop } = await createMockServer(4851);

    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 }
    });

    try {
      await client.connect(endpointUrl);
      const session = await client.createSession();

      const callResult = await session.call({
        objectId:  'ns=1;s=TestDevice',
        methodId:  'ns=1;s=EchoMethod',
        inputArguments: [
          new Variant({ dataType: DataType.String, value: 'Hello OPC UA' }) // TEST DATA
        ]
      });

      assert.ok(callResult.statusCode.isGood());
      assert.strictEqual(callResult.outputArguments[0].value, 'Hello OPC UA');

      await session.close();
      await client.disconnect();
    } finally {
      await stop();
    }
  });

  it('handles concurrent method calls correctly', async function () {
    this.timeout(15000);
    const { endpointUrl, stop } = await createMockServer(4852);

    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 }
    });

    try {
      await client.connect(endpointUrl);
      const session = await client.createSession();

      // Fire three concurrent Add calls
      const calls = [
        session.call({
          objectId: 'ns=1;s=TestDevice',
          methodId: 'ns=1;s=AddMethod',
          inputArguments: [
            new Variant({ dataType: DataType.Double, value: 1.0 }), // TEST DATA
            new Variant({ dataType: DataType.Double, value: 2.0 })  // TEST DATA
          ]
        }),
        session.call({
          objectId: 'ns=1;s=TestDevice',
          methodId: 'ns=1;s=AddMethod',
          inputArguments: [
            new Variant({ dataType: DataType.Double, value: 10.0 }), // TEST DATA
            new Variant({ dataType: DataType.Double, value: 20.0 })  // TEST DATA
          ]
        }),
        session.call({
          objectId: 'ns=1;s=TestDevice',
          methodId: 'ns=1;s=AddMethod',
          inputArguments: [
            new Variant({ dataType: DataType.Double, value: 100.0 }), // TEST DATA
            new Variant({ dataType: DataType.Double, value: 200.0 })  // TEST DATA
          ]
        })
      ];

      const results = await Promise.all(calls);

      assert.ok(results[0].statusCode.isGood());
      assert.ok(results[1].statusCode.isGood());
      assert.ok(results[2].statusCode.isGood());
      assert.ok(Math.abs(results[0].outputArguments[0].value - 3.0) < 0.001);
      assert.ok(Math.abs(results[1].outputArguments[0].value - 30.0) < 0.001);
      assert.ok(Math.abs(results[2].outputArguments[0].value - 300.0) < 0.001);

      await session.close();
      await client.disconnect();
    } finally {
      await stop();
    }
  });
});

'use strict';
// WP-S-1 + WP-S-2: Integration test — server lifecycle (start, stop, redeploy)
// and address space verification (read/write variables via OPC UA client)
// See: docs/work-packages.md#wp-s-1-kern-server--lifecycle-management
// See: docs/work-packages.md#wp-s-2-address-space-builder--context-bridge

const assert = require('assert');
const { OPCUAClient, DataType, AttributeIds } = require('node-opcua');
const { createMockServer } = require('../fixtures/mock-server');

describe('Server Lifecycle (Integration)', () => {
  it('starts and stops without port conflict on redeploy', async function () {
    this.timeout(15000);
    const PORT = 4844;

    const s1 = await createMockServer(PORT);
    await s1.stop();

    // Second start on same port must succeed (no EADDRINUSE)
    const s2 = await createMockServer(PORT);
    await s2.stop();

    assert.ok(true, 'Both start/stop cycles completed without port conflict');
  });

  it('exposes OPC UA variables on the expected NodeIds', async function () {
    this.timeout(15000);
    const { server, endpointUrl, state, stop } = await createMockServer(4845);

    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 }
    });

    try {
      await client.connect(endpointUrl);
      const session = await client.createSession();

      // Read Temperature variable
      const tempResult = await session.read({
        nodeId: 'ns=1;s=Temperature',
        attributeId: AttributeIds.Value
      });
      assert.strictEqual(tempResult.value.dataType, DataType.Double);
      assert.strictEqual(tempResult.value.value, state.temperature,
        'Read value must match server state');

      // Read DeviceStatus (String)
      const statusResult = await session.read({
        nodeId: 'ns=1;s=DeviceStatus',
        attributeId: AttributeIds.Value
      });
      assert.strictEqual(statusResult.value.dataType, DataType.String);
      assert.strictEqual(statusResult.value.value, 'Running'); // TEST DATA — initial mock state

      await session.close();
      await client.disconnect();
    } finally {
      await stop();
    }
  });

  it('allows write and re-read of Temperature variable', async function () {
    this.timeout(15000);
    const { endpointUrl, state, stop } = await createMockServer(4846);

    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 }
    });

    try {
      await client.connect(endpointUrl);
      const session = await client.createSession();

      // Write new temperature value
      const writeResult = await session.write({
        nodeId: 'ns=1;s=Temperature',
        attributeId: AttributeIds.Value,
        value: {
          value: { dataType: DataType.Double, value: 99.9 } // TEST DATA
        }
      });
      assert.ok(writeResult.isGood(), 'Write must return Good status');

      // Re-read to verify
      const readResult = await session.read({
        nodeId: 'ns=1;s=Temperature',
        attributeId: AttributeIds.Value
      });
      assert.strictEqual(readResult.value.value, 99.9,
        'Re-read after write must reflect new value');
      assert.strictEqual(state.temperature, 99.9,
        'Server state must be updated by write');

      await session.close();
      await client.disconnect();
    } finally {
      await stop();
    }
  });

  it('survives rapid start/stop cycles (3x) without port conflict', async function () {
    this.timeout(30000);
    const PORT = 4847;

    for (let i = 0; i < 3; i++) {
      const s = await createMockServer(PORT);
      await s.stop();
    }
    assert.ok(true, '3 rapid start/stop cycles completed');
  });
});

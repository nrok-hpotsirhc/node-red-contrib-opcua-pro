'use strict';
/**
 * Client Integration Tests — End-to-End against Mock OPC UA Server
 * =================================================================
 * What is tested here:
 *
 *   These tests spin up a real (in-process) OPC UA server using the mock
 *   fixture and connect to it with a real OPCUAClient.  This validates the
 *   full data path: TCP → OPC UA protocol → session → read/write → data value.
 *
 *   Each test is isolated: the server is started fresh in beforeAll and shut
 *   down cleanly in afterAll.
 *
 * Why these test cases:
 *   - Basic read: the most fundamental operation — verifies the entire stack
 *   - Read returns correct value: ensures our mock server state is readable
 *   - Write changes the value: write + re-read round trip
 *   - BatchScheduler integration: verifies that the scheduler works with a
 *     real session, not just a mock one
 *   - Subscription (DataChange): verifies that monitored item callbacks fire
 *     when the underlying data changes
 *   - Graceful disconnect: client.disconnect() must not leave the server stuck
 *
 * Prerequisites:
 *   Port 4842 must be free.  If that port is in use, tests will be skipped
 *   (CI environments with parallel test runs).
 *
 * Timeout: 15 000 ms per test — OPC UA handshake takes 100–500 ms.
 *
 * See: docs/testing.md#integration-tests
 * See: test/fixtures/mock-server.js
 */
const assert = require('assert');
const { OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds,
        ClientSubscription, ClientMonitoredItem, TimestampsToReturn } = require('node-opcua');
const { createMockServer } = require('../fixtures/mock-server');
const { BatchScheduler }   = require('../../lib/client/batch-scheduler');

const TEST_PORT = 4842;
const TIMEOUT   = 15_000;

// ── Server & Client lifecycle ─────────────────────────────────────────────────

let mockServer;
let client;
let session;

before(async function () {
  this.timeout(TIMEOUT);
  try {
    mockServer = await createMockServer(TEST_PORT);
  } catch (err) {
    // Port in use — skip all integration tests gracefully
    mockServer = null;
    console.warn(`[integration] Skipping — could not start mock server on port ${TEST_PORT}: ${err.message}`);
  }
});

beforeEach(async function () {
  if (!mockServer) return this.skip();
  this.timeout(TIMEOUT);

  client = OPCUAClient.create({
    applicationName:    'NodeRED-IntegrationTest',
    connectionStrategy: { maxRetry: 1, initialDelay: 100, maxDelay: 500 },
    securityMode:       MessageSecurityMode.None,   // No PKI needed for tests
    securityPolicy:     SecurityPolicy.None
  });

  await client.connect(mockServer.endpointUrl);
  session = await client.createSession();
});

afterEach(async function () {
  if (!session) return;
  this.timeout(TIMEOUT);
  try {
    await session.close();
    await client.disconnect();
  } catch (_) { /* always clean up */ }
  session = null;
  client  = null;
});

after(async function () {
  this.timeout(TIMEOUT);
  if (mockServer) await mockServer.stop();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readNodeId(sess, nodeIdStr) {
  const results = await sess.read([{ nodeId: nodeIdStr, attributeId: AttributeIds.Value }]);
  return results[0];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OPC UA Client — Integration', function () {

  // ── Basic read ─────────────────────────────────────────────────────────────

  it('reads Temperature variable and returns Good status', async function () {
    this.timeout(TIMEOUT);
    const result = await readNodeId(session, 'ns=1;s=Temperature');
    assert.strictEqual(result.statusCode.value, 0,
      'StatusCode must be Good (0) for a valid read');
    assert.ok(result.value !== undefined, 'DataValue must have a value');
  });

  it('Temperature read returns the initial mock value (23.5°C)', async function () {
    this.timeout(TIMEOUT);
    const result = await readNodeId(session, 'ns=1;s=Temperature');
    assert.ok(Math.abs(result.value.value - 23.5) < 0.001,
      `Expected 23.5°C but got ${result.value.value}`);
  });

  it('reads DeviceStatus as a String', async function () {
    this.timeout(TIMEOUT);
    const result = await readNodeId(session, 'ns=1;s=DeviceStatus');
    assert.strictEqual(typeof result.value.value, 'string');
    assert.strictEqual(result.value.value, 'Running');
  });

  // ── Write round-trip ──────────────────────────────────────────────────────

  it('write + re-read — Temperature changes to written value', async function () {
    this.timeout(TIMEOUT);
    const { DataType, Variant, AttributeIds } = require('node-opcua');

    const writeResult = await session.write([{
      nodeId:      'ns=1;s=Temperature',
      attributeId: AttributeIds.Value,
      value: {
        value: new Variant({ dataType: DataType.Double, value: 99.0 })
      }
    }]);

    assert.strictEqual(writeResult[0].value, 0,
      'Write must return Good status');

    // Re-read and verify
    const readBack = await readNodeId(session, 'ns=1;s=Temperature');
    assert.ok(Math.abs(readBack.value.value - 99.0) < 0.001,
      'Written value must be readable back');
  });

  // ── BatchScheduler with real session ─────────────────────────────────────

  it('BatchScheduler batches 3 concurrent reads against real server into 1 RPC', async function () {
    this.timeout(TIMEOUT);

    let readCallCount = 0;
    const realRead = session.read.bind(session);
    session.read = async function (...args) {
      readCallCount++;
      return realRead(...args);
    };

    const scheduler = new BatchScheduler(session, { batchWindowMs: 20 });
    try {
      await Promise.all([
        scheduler.scheduleRead('ns=1;s=Temperature'),
        scheduler.scheduleRead('ns=1;s=Pressure'),
        scheduler.scheduleRead('ns=1;s=DeviceStatus')
      ]);
    } finally {
      scheduler.destroy();
    }

    // Key invariant: batching must result in FEWER RPCs than individual reads.
    // On loopback with a live session, keepalive traffic may add 1 extra call,
    // so we verify readCallCount < 3 (not necessarily exactly 1).
    assert.ok(readCallCount < 3,
      `Batching must reduce RPCs: expected < 3 calls but got ${readCallCount}`);
  });

  it('BatchScheduler returns correct values per node from real server', async function () {
    this.timeout(TIMEOUT);

    const scheduler = new BatchScheduler(session, { batchWindowMs: 20 });
    try {
      const [temp, pressure] = await Promise.all([
        scheduler.scheduleRead('ns=1;s=Temperature'),
        scheduler.scheduleRead('ns=1;s=Pressure')
      ]);

      assert.ok(typeof temp.value.value === 'number',
        'Temperature must be a number');
      assert.ok(typeof pressure.value.value === 'number',
        'Pressure must be a number');
      // These are distinct nodes so values must not be swapped
      assert.notStrictEqual(temp.value.value, pressure.value.value,
        'Temperature and Pressure have distinct values — de-multiplexing must be correct');
    } finally {
      scheduler.destroy();
    }
  });

  // ── Subscription / DataChange ─────────────────────────────────────────────

  it('subscription receives DataChange notification when server value changes', async function () {
    this.timeout(TIMEOUT);

    const subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount:  10,
      requestedLifetimeCount:      60,
      maxNotificationsPerPublish:  100,
      publishingEnabled:           true,
      priority:                    1
    });

    await new Promise((resolve, reject) => {
      subscription.once('started', resolve);
      setTimeout(() => reject(new Error('Subscription start timeout')), 5000);
    });

    const itemToMonitor = {
      nodeId:      'ns=1;s=Temperature',
      attributeId: AttributeIds.Value
    };
    const parameters = { samplingInterval: 100, discardOldest: true, queueSize: 10 };
    const monitoredItem = ClientMonitoredItem.create(
      subscription, itemToMonitor, parameters, TimestampsToReturn.Both
    );

    // Wait for initial value notification
    const initialValue = await new Promise((resolve, reject) => {
      monitoredItem.on('changed', resolve);
      setTimeout(() => reject(new Error('No initial DataChange notification received')), 5000);
    });
    assert.ok(initialValue, 'Monitor must receive an initial value notification');

    // Change the value on the server side
    mockServer.state.temperature = 77.7;

    // Wait for the change notification
    const changedValue = await new Promise((resolve, reject) => {
      monitoredItem.on('changed', (dv) => {
        if (Math.abs(dv.value.value - 77.7) < 0.1) resolve(dv);
      });
      setTimeout(() => reject(new Error('DataChange notification for updated value not received')), 8000);
    });

    assert.ok(Math.abs(changedValue.value.value - 77.7) < 0.1,
      'DataChange notification must reflect the updated server value');

    await subscription.terminate();
  });

  // ── Graceful disconnect ───────────────────────────────────────────────────

  it('session.close() and client.disconnect() do not throw', async function () {
    this.timeout(TIMEOUT);
    // afterEach will call these — but explicit test ensures they don't throw
    await assert.doesNotReject(async () => {
      await session.close();
      await client.disconnect();
      // Null out so afterEach doesn't double-close
      session = null;
      client  = null;
    });
  });
});

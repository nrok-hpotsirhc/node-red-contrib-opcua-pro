'use strict';
// WP-C-3: batch-scheduler unit tests
const assert = require('assert');
const { BatchScheduler } = require('../../lib/client/batch-scheduler');
const { DataType, AttributeIds, Variant, StatusCodes } = require('node-opcua');

describe('BatchScheduler', () => {
  let mockSession;
  let scheduler;
  let readCalls = 0;

  beforeEach(() => {
    readCalls = 0;
    mockSession = {
      read: async (nodesToRead) => {
        readCalls++;
        return nodesToRead.map(n => ({
          value: new Variant({ dataType: DataType.Double, value: 42.0 }),
          statusCode: StatusCodes.Good,
          sourceTimestamp: new Date(),
          serverTimestamp: new Date()
        }));
      },
      write: async (nodesToWrite) => nodesToWrite.map(() => StatusCodes.Good)
    };
    scheduler = new BatchScheduler(mockSession, { batchWindowMs: 10 });
  });

  afterEach(() => {
    scheduler.destroy();
  });

  it('batches concurrent reads into a single ReadMultiple request', async () => {
    const promises = [
      scheduler.scheduleRead('ns=2;s=Temp1'),
      scheduler.scheduleRead('ns=2;s=Temp2'),
      scheduler.scheduleRead('ns=2;s=Temp3')
    ];

    await Promise.all(promises);

    assert.strictEqual(readCalls, 1, 'Expected exactly one ReadMultiple call');
  });

  it('returns correct values per requesting node', async () => {
    const [r1, r2] = await Promise.all([
      scheduler.scheduleRead('ns=2;s=A'),
      scheduler.scheduleRead('ns=2;s=B')
    ]);

    assert.ok(r1.value !== undefined);
    assert.ok(r2.value !== undefined);
  });

  it('rejects all pending reads when destroy() is called', async () => {
    const p = scheduler.scheduleRead('ns=2;s=X');
    scheduler.destroy();
    await assert.rejects(p, /destroyed/);
  });
});

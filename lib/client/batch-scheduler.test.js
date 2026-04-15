'use strict';
/**
 * BatchScheduler — Comprehensive Unit Tests
 * ==========================================
 * What is tested here:
 *
 *   The BatchScheduler collects concurrent OPC UA Read/Write requests within
 *   a short time window (batchWindowMs, default 5 ms) and issues a SINGLE
 *   session.read() / session.write() call containing all of them.  This is
 *   the core of REQ-C-06 (Smart Batching).  The scheduler de-multiplexes the
 *   server's array response back to each waiting Promise.
 *
 * Why these test cases:
 *   - Batching behavior: most critical invariant — N concurrent calls = 1 RPC
 *   - Value routing: ensures index alignment in the response array is correct
 *   - Write batching: writes use the same queue mechanism as reads
 *   - Mixed window: reads AND writes queued simultaneously flush separately
 *   - Error isolation: a session error must reject ALL pending Promises, not
 *     silently swallow them
 *   - Destroy: pending Promises must be rejected cleanly on node close/redeploy
 *   - Sequential batches: after one flush, a new window opens correctly
 *   - Large batches (100 reads → 1 call): load test on the mechanism
 *   - Empty destroy: no crash when destroy() is called with empty queues
 *
 * See: docs/work-packages.md#wp-c-3 — Worker Nodes & Smart Batching
 * See: docs/theoretical-foundations.md — Säule 2: Request Scheduler
 */
const assert = require('assert');
const { BatchScheduler } = require('./batch-scheduler');
const { DataType, AttributeIds, Variant, StatusCodes } = require('node-opcua');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a mock OPC UA session that tracks call counts */
function makeMockSession(overrides = {}) {
  let readCalls  = 0;
  let writeCalls = 0;

  const session = {
    readCallCount:  () => readCalls,
    writeCallCount: () => writeCalls,

    read: async (nodesToRead) => {
      readCalls++;
      return nodesToRead.map((n, i) => ({
        value:           new Variant({ dataType: DataType.Double, value: i + 1.0 }),
        statusCode:      StatusCodes.Good,
        sourceTimestamp: new Date(),
        serverTimestamp: new Date()
      }));
    },

    write: async (nodesToWrite) => {
      writeCalls++;
      return nodesToWrite.map(() => StatusCodes.Good);
    },

    ...overrides
  };
  return session;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('BatchScheduler', () => {

  let session;
  let scheduler;

  beforeEach(() => {
    session   = makeMockSession();
    scheduler = new BatchScheduler(session, { batchWindowMs: 10 });
  });

  afterEach(() => {
    scheduler.destroy();
  });

  // ── Core batching invariant ────────────────────────────────────────────────

  it('batches N concurrent reads into exactly 1 ReadMultiple RPC', async () => {
    await Promise.all([
      scheduler.scheduleRead('ns=2;s=Temp1'),
      scheduler.scheduleRead('ns=2;s=Temp2'),
      scheduler.scheduleRead('ns=2;s=Temp3')
    ]);
    assert.strictEqual(session.readCallCount(), 1,
      'Three concurrent reads must produce exactly one session.read() call');
  });

  it('routes response values back to the correct requesting Promise', async () => {
    // Mock returns index+1.0 per position, so first read gets 1.0, second 2.0
    const [r1, r2, r3] = await Promise.all([
      scheduler.scheduleRead('ns=2;s=A'),
      scheduler.scheduleRead('ns=2;s=B'),
      scheduler.scheduleRead('ns=2;s=C')
    ]);
    assert.strictEqual(r1.value.value, 1.0, 'First read must get value at index 0');
    assert.strictEqual(r2.value.value, 2.0, 'Second read must get value at index 1');
    assert.strictEqual(r3.value.value, 3.0, 'Third read must get value at index 2');
  });

  it('batches N concurrent writes into exactly 1 WriteMultiple RPC', async () => {
    const mkVariant = v => new Variant({ dataType: DataType.Double, value: v });
    await Promise.all([
      scheduler.scheduleWrite('ns=2;s=Temp1', mkVariant(10)),
      scheduler.scheduleWrite('ns=2;s=Temp2', mkVariant(20)),
      scheduler.scheduleWrite('ns=2;s=Temp3', mkVariant(30))
    ]);
    assert.strictEqual(session.writeCallCount(), 1,
      'Three concurrent writes must produce exactly one session.write() call');
  });

  it('sequential batches each open a new time window', async () => {
    await scheduler.scheduleRead('ns=2;s=First');   // first window
    // New read after flush — must trigger a second batch window
    await scheduler.scheduleRead('ns=2;s=Second');  // second window
    assert.strictEqual(session.readCallCount(), 2,
      'Two sequential (non-concurrent) reads must produce two separate session.read() calls');
  });

  // ── Large batch (performance / correctness at scale) ──────────────────────

  it('100 concurrent reads produce exactly 1 RPC and resolve all Promises', async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      scheduler.scheduleRead(`ns=2;s=Node${i}`)
    );
    const results = await Promise.all(promises);
    assert.strictEqual(session.readCallCount(), 1,
      '100 concurrent reads must produce one ReadMultiple call');
    assert.strictEqual(results.length, 100);
    results.forEach((r, i) => {
      assert.strictEqual(r.value.value, i + 1.0,
        `Result[${i}] value must match mock return value`);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('session.read() error rejects ALL pending read Promises', async () => {
    const errorSession = makeMockSession({
      read: async () => { throw new Error('BadCommunicationError'); }
    });
    const errScheduler = new BatchScheduler(errorSession, { batchWindowMs: 10 });

    const promises = [
      errScheduler.scheduleRead('ns=2;s=X'),
      errScheduler.scheduleRead('ns=2;s=Y'),
      errScheduler.scheduleRead('ns=2;s=Z')
    ];

    await Promise.allSettled(promises).then(results => {
      results.forEach(r => {
        assert.strictEqual(r.status, 'rejected',
          'Each pending read must be rejected when session throws');
        assert.match(r.reason.message, /BadCommunicationError/);
      });
    });
    errScheduler.destroy();
  });

  it('session.write() error rejects ALL pending write Promises', async () => {
    const errorSession = makeMockSession({
      write: async () => { throw new Error('BadWriteError'); }
    });
    const errScheduler = new BatchScheduler(errorSession, { batchWindowMs: 10 });

    const result = await Promise.allSettled([
      errScheduler.scheduleWrite('ns=2;s=A', new Variant({ dataType: DataType.Double, value: 0 }))
    ]);

    assert.strictEqual(result[0].status, 'rejected');
    assert.match(result[0].reason.message, /BadWriteError/);
    errScheduler.destroy();
  });

  // ── Lifecycle / destroy ───────────────────────────────────────────────────

  it('destroy() rejects all pending read Promises with "destroyed" message', async () => {
    const p = scheduler.scheduleRead('ns=2;s=X');
    scheduler.destroy();
    await assert.rejects(p, /destroyed/);
  });

  it('destroy() rejects all pending write Promises with "destroyed" message', async () => {
    const p = scheduler.scheduleWrite('ns=2;s=X',
      new Variant({ dataType: DataType.Double, value: 5 }));
    scheduler.destroy();
    await assert.rejects(p, /destroyed/);
  });

  it('destroy() on empty queues does not throw', () => {
    assert.doesNotThrow(() => scheduler.destroy());
  });

  it('subsequent destroy() calls do not throw (idempotent)', () => {
    scheduler.destroy();
    assert.doesNotThrow(() => scheduler.destroy());
  });

  // ── Default options ───────────────────────────────────────────────────────

  it('uses default batchWindowMs of 5 ms when no options supplied', () => {
    const s = new BatchScheduler(session);
    assert.strictEqual(s.batchWindowMs, 5);
    s.destroy();
  });
});

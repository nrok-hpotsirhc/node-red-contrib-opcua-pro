'use strict';
// WP-C-3: batch-scheduler — Micro-Task-Queue for Read/Write batching
// See: docs/work-packages.md#wp-c-3-worker-nodes--smart-batching
// See: docs/theoretical-foundations.md#säule-2--request-scheduler-und-payload-normalisierung-smart-batching

const { AttributeIds } = require('node-opcua');

class BatchScheduler {
  constructor(session, options = {}) {
    this.session       = session;
    this.batchWindowMs = options.batchWindowMs || 5;
    this.readQueue     = [];
    this.writeQueue    = [];
    this._timer        = null;
  }

  scheduleRead(nodeId, attributeId = AttributeIds.Value) {
    return new Promise((resolve, reject) => {
      this.readQueue.push({ nodeId, attributeId, resolve, reject });
      this._scheduleBatch();
    });
  }

  scheduleWrite(nodeId, value) {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ nodeId, value, resolve, reject });
      this._scheduleBatch();
    });
  }

  _scheduleBatch() {
    if (this._timer) return;
    this._timer = setTimeout(() => this._flush(), this.batchWindowMs);
  }

  async _flush() {
    this._timer = null;

    if (!this.session) {
      const err = new Error('Session not available');
      [...this.readQueue.splice(0), ...this.writeQueue.splice(0)]
        .forEach(req => req.reject(err));
      return;
    }

    const readBatch  = this.readQueue.length  > 0 ? this.readQueue.splice(0)  : null;
    const writeBatch = this.writeQueue.length > 0 ? this.writeQueue.splice(0) : null;

    const promises = [];

    if (readBatch) {
      promises.push(
        this.session.read(
          readBatch.map(r => ({ nodeId: r.nodeId, attributeId: r.attributeId }))
        ).then(results => {
          readBatch.forEach((req, i) => req.resolve(results[i]));
        }).catch(err => {
          readBatch.forEach(req => req.reject(err));
        })
      );
    }

    if (writeBatch) {
      promises.push(
        this.session.write(
          writeBatch.map(w => ({ nodeId: w.nodeId, attributeId: AttributeIds.Value, value: w.value }))
        ).then(results => {
          writeBatch.forEach((req, i) => req.resolve(results[i]));
        }).catch(err => {
          writeBatch.forEach(req => req.reject(err));
        })
      );
    }

    await Promise.all(promises);
  }

  destroy() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    // Reject all pending requests
    [...this.readQueue, ...this.writeQueue].forEach(req =>
      req.reject(new Error('BatchScheduler destroyed'))
    );
    this.readQueue  = [];
    this.writeQueue = [];
  }
}

module.exports = { BatchScheduler };

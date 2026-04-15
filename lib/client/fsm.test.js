'use strict';
// Unit tests for OpcuaClientFSM — no node-opcua dependency
// These are the M1 acceptance criterion tests.

const assert = require('assert');
const { OpcuaClientFSM } = require('./fsm');

describe('OpcuaClientFSM', () => {

  let fsm;
  beforeEach(() => { fsm = new OpcuaClientFSM(); });

  it('starts in DISCONNECTED state', () => {
    assert.strictEqual(fsm.state, 'DISCONNECTED');
  });

  it('DISCONNECTED → CONNECTING', () => {
    fsm.transition('CONNECTING');
    assert.strictEqual(fsm.state, 'CONNECTING');
  });

  it('CONNECTING → CONNECTED → SESSION_ACTIVE', () => {
    fsm.transition('CONNECTING');
    fsm.transition('CONNECTED');
    fsm.transition('SESSION_ACTIVE');
    assert.strictEqual(fsm.state, 'SESSION_ACTIVE');
  });

  it('full reconnect path: SESSION_ACTIVE → CONNECTION_LOST → RECONNECTING → CONNECTED', () => {
    fsm.transition('CONNECTING');
    fsm.transition('CONNECTED');
    fsm.transition('SESSION_ACTIVE');
    fsm.transition('CONNECTION_LOST');
    fsm.transition('RECONNECTING');
    fsm.transition('CONNECTED');
    assert.strictEqual(fsm.state, 'CONNECTED');
  });

  it('emits stateChange with newState and prevState', () => {
    const events = [];
    fsm.on('stateChange', (next, prev) => events.push({ next, prev }));
    fsm.transition('CONNECTING');
    fsm.transition('DISCONNECTED');
    assert.deepStrictEqual(events, [
      { next: 'CONNECTING',   prev: 'DISCONNECTED' },
      { next: 'DISCONNECTED', prev: 'CONNECTING'   }
    ]);
  });

  it('throws on invalid transition DISCONNECTED → SESSION_ACTIVE', () => {
    assert.throws(
      () => fsm.transition('SESSION_ACTIVE'),
      /Invalid FSM transition: DISCONNECTED → SESSION_ACTIVE/
    );
  });

  it('throws on DISCONNECTED → RECONNECTING', () => {
    assert.throws(
      () => fsm.transition('RECONNECTING'),
      /Invalid FSM transition/
    );
  });

  it('allows CONNECTING → DISCONNECTED (connect failure)', () => {
    fsm.transition('CONNECTING');
    fsm.transition('DISCONNECTED');
    assert.strictEqual(fsm.state, 'DISCONNECTED');
  });

  it('allows SESSION_ACTIVE → DISCONNECTED (graceful close)', () => {
    fsm.transition('CONNECTING');
    fsm.transition('CONNECTED');
    fsm.transition('SESSION_ACTIVE');
    fsm.transition('DISCONNECTED');
    assert.strictEqual(fsm.state, 'DISCONNECTED');
  });

  it('allows CONNECTION_LOST → DISCONNECTED (give up reconnecting)', () => {
    fsm.transition('CONNECTING');
    fsm.transition('CONNECTED');
    fsm.transition('CONNECTION_LOST');
    fsm.transition('DISCONNECTED');
    assert.strictEqual(fsm.state, 'DISCONNECTED');
  });
});

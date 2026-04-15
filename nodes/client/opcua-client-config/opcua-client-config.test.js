'use strict';
// Unit tests for OpcuaClientFSM (M1 acceptance criteria)
// Run: npm test -- --grep "OpcuaClientFSM"

const assert = require('assert');
// Import FSM directly from lib — no node-opcua dependency required
const { OpcuaClientFSM } = require('../../../lib/client/fsm');

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

  it('SESSION_ACTIVE → CONNECTION_LOST → RECONNECTING → CONNECTED', () => {
    fsm.transition('CONNECTING');
    fsm.transition('CONNECTED');
    fsm.transition('SESSION_ACTIVE');
    fsm.transition('CONNECTION_LOST');
    fsm.transition('RECONNECTING');
    fsm.transition('CONNECTED');
    assert.strictEqual(fsm.state, 'CONNECTED');
  });

  it('emits stateChange event with newState and prevState', () => {
    const events = [];
    fsm.on('stateChange', (next, prev) => events.push({ next, prev }));
    fsm.transition('CONNECTING');
    fsm.transition('DISCONNECTED');
    assert.deepStrictEqual(events, [
      { next: 'CONNECTING',   prev: 'DISCONNECTED' },
      { next: 'DISCONNECTED', prev: 'CONNECTING'   }
    ]);
  });

  it('throws on invalid transition', () => {
    assert.throws(
      () => fsm.transition('SESSION_ACTIVE'),
      /Invalid FSM transition: DISCONNECTED → SESSION_ACTIVE/
    );
  });

  it('throws on transition from DISCONNECTED to RECONNECTING (not allowed)', () => {
    assert.throws(
      () => fsm.transition('RECONNECTING'),
      /Invalid FSM transition/
    );
  });

  it('allows CONNECTING → DISCONNECTED (connect failure path)', () => {
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
});

'use strict';
// WP-C-1 (M1): Finite State Machine for OPC UA client connection lifecycle
// Separated from opcua-client-config.js for independent unit testing (no node-opcua dep).
// See: docs/theoretical-foundations.md#10-node-red-architektur-und-low-code-paradigma

const EventEmitter = require('events');

/**
 * OpcuaClientFSM — tracks connection states and validates transitions.
 *
 * States:
 *   DISCONNECTED → CONNECTING → CONNECTED → SESSION_ACTIVE
 *                              ↓                  ↓
 *                         DISCONNECTED       CONNECTION_LOST → RECONNECTING → CONNECTED
 *                                                           ↓
 *                                                      DISCONNECTED
 *
 * Emits: 'stateChange' (newState, prevState)
 */
class OpcuaClientFSM extends EventEmitter {
  constructor() {
    super();
    this.state = 'DISCONNECTED';
  }

  transition(newState) {
    if (!OpcuaClientFSM.TRANSITIONS[this.state]?.includes(newState)) {
      throw new Error(`Invalid FSM transition: ${this.state} → ${newState}`);
    }
    const prev = this.state;
    this.state = newState;
    this.emit('stateChange', newState, prev);
  }
}

OpcuaClientFSM.TRANSITIONS = Object.freeze({
  DISCONNECTED:    ['CONNECTING'],
  CONNECTING:      ['CONNECTED', 'DISCONNECTED'],
  CONNECTED:       ['SESSION_ACTIVE', 'CONNECTION_LOST', 'DISCONNECTED'],
  SESSION_ACTIVE:  ['CONNECTION_LOST', 'DISCONNECTED'],
  CONNECTION_LOST: ['RECONNECTING', 'DISCONNECTED'],
  RECONNECTING:    ['CONNECTED', 'DISCONNECTED']
});

module.exports = { OpcuaClientFSM };

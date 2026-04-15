'use strict';
// WP-C-1: opcua-client-config — Central Connection Manager (Finite State Machine)
// See: docs/work-packages.md#wp-c-1-basis-infrastruktur--configuration-node
// See: docs/theoretical-foundations.md#10-node-red-architektur-und-low-code-paradigma

const { OPCUAClient, MessageSecurityMode, SecurityPolicy, UserTokenType } = require('node-opcua');
const EventEmitter = require('events');
const path = require('path');

module.exports = function (RED) {

  class OpcuaClientFSM extends EventEmitter {
    constructor() {
      super();
      this.state = 'DISCONNECTED';
    }

    transition(newState) {
      const allowed = {
        DISCONNECTED:    ['CONNECTING'],
        CONNECTING:      ['CONNECTED', 'DISCONNECTED'],
        CONNECTED:       ['SESSION_ACTIVE', 'CONNECTION_LOST'],
        SESSION_ACTIVE:  ['CONNECTION_LOST', 'DISCONNECTED'],
        CONNECTION_LOST: ['RECONNECTING', 'DISCONNECTED'],
        RECONNECTING:    ['CONNECTED', 'DISCONNECTED']
      };
      if (!allowed[this.state]?.includes(newState)) {
        throw new Error(`Invalid FSM transition: ${this.state} → ${newState}`);
      }
      const prev = this.state;
      this.state = newState;
      this.emit('stateChange', newState, prev);
    }
  }

  function OpcuaClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.fsm        = new OpcuaClientFSM();
    node.client     = null;
    node.session    = null;
    node.scheduler  = null;  // Initialized in WP-C-3

    // TODO WP-C-1: Implement full connection lifecycle
    // TODO WP-C-2: Implement exponential backoff reconnect
    // TODO WP-C-3: Initialize BatchScheduler
    // TODO WP-C-5: Initialize PKI / auto-generate certificate

    node.on('close', async (removed, done) => {
      // TODO WP-C-1: Graceful disconnect — session.close() → client.disconnect()
      done();
    });
  }

  RED.nodes.registerType('opcua-client-config', OpcuaClientConfig, {
    credentials: {
      username: { type: 'text' },
      password: { type: 'password' }
    }
  });

  // TODO WP-C-4: Register RED.httpAdmin browse route
  // TODO WP-C-5: Register RED.httpAdmin PKI routes
};

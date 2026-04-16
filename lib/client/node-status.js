'use strict';
// Shared FSM-state → Node-RED visual status mapping for all client worker nodes.
// Import this instead of copy-pasting the same STATUS_MAP in every node file.

const STATUS_MAP = Object.freeze({
  DISCONNECTED:    { fill: 'red',    shape: 'ring', text: 'Disconnected' },
  CONNECTING:      { fill: 'yellow', shape: 'ring', text: 'Connecting...' },
  CONNECTED:       { fill: 'yellow', shape: 'dot',  text: 'Connected' },
  SESSION_ACTIVE:  { fill: 'green',  shape: 'dot',  text: 'Ready' },
  CONNECTION_LOST: { fill: 'red',    shape: 'dot',  text: 'Connection lost' },
  RECONNECTING:    { fill: 'yellow', shape: 'ring', text: 'Reconnecting...' }
});

module.exports = { STATUS_MAP };

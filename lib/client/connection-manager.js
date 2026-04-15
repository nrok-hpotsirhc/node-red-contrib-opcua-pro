'use strict';
// WP-C-2: connection-manager — Exponential backoff reconnect logic
// See: docs/work-packages.md#wp-c-2-resilience-engineering-session--error-management
// See: docs/theoretical-foundations.md#13-technische-grundlage-node-opcua-bibliothek

const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = require('node-opcua');
const { classifyError, ErrorCategory } = require('./error-handler');

const DEFAULT_CONNECTION_STRATEGY = {
  initialDelay:         1000,
  maxDelay:             30000,
  maxRetry:             Infinity,
  randomisationFactor:  0.1
};

/**
 * Create an OPCUAClient with industrial-grade defaults.
 * node-opcua's built-in reconnect machinery (connection_lost / reconnecting /
 * connection_reestablished events) is used instead of rolling our own.
 *
 * @param {object} config — endpoint, security, certificate settings
 * @returns {OPCUAClient}
 */
function createClient(config) {
  return OPCUAClient.create({
    applicationName:    config.applicationName || 'NodeRED-OpcUA-Client',
    connectionStrategy: { ...DEFAULT_CONNECTION_STRATEGY, ...config.connectionStrategy },
    securityMode:       config.securityMode   || MessageSecurityMode.SignAndEncrypt,
    securityPolicy:     config.securityPolicy || SecurityPolicy.Basic256Sha256,
    certificateFile:    config.certificateFile,
    privateKeyFile:     config.privateKeyFile,
    keepSessionAlive:   true,
    requestedSessionTimeout: config.requestedSessionTimeout || 60000
  });
}

/**
 * Wire node-opcua reconnect events to the FSM and a logger.
 * Called once after client.connect() succeeds.
 *
 * @param {OPCUAClient}   client  — connected OPC UA client
 * @param {OpcuaClientFSM} fsm    — connection state machine
 * @param {object}         logger — object with .warn(), .error(), .log() (Node-RED node)
 */
function wireReconnectEvents(client, fsm, logger) {
  client.on('connection_lost', () => {
    if (fsm.state === 'SESSION_ACTIVE' || fsm.state === 'CONNECTED') {
      try { fsm.transition('CONNECTION_LOST'); } catch (_) { /* already in target state */ }
    }
    logger.warn('OPC UA connection lost — reconnect will start automatically');
  });

  client.on('reconnecting', () => {
    if (fsm.state === 'CONNECTION_LOST') {
      try { fsm.transition('RECONNECTING'); } catch (_) { /* guard */ }
    }
  });

  client.on('connection_reestablished', () => {
    if (fsm.state === 'RECONNECTING' || fsm.state === 'CONNECTION_LOST') {
      try { fsm.transition('CONNECTED'); } catch (_) { /* guard */ }
    }
    logger.log('OPC UA connection re-established');
  });
}

/**
 * Log OPC UA errors with appropriate severity based on classification.
 *
 * @param {Error}  err    — error to classify and log
 * @param {object} logger — Node-RED node logger
 */
function logClassifiedError(err, logger) {
  const { category, statusCodeName, message } = classifyError(err);
  switch (category) {
    case ErrorCategory.LIMIT:
      logger.error(`[CRITICAL] OPC UA resource limit: ${statusCodeName} — ${message}`);
      break;
    case ErrorCategory.AUTH:
      logger.error(`[AUTH] OPC UA authentication failure: ${statusCodeName} — ${message}. Auto-retry disabled.`);
      break;
    case ErrorCategory.RECONNECT:
    case ErrorCategory.NEW_SESSION:
      logger.warn(`[RECOVERABLE] OPC UA error: ${statusCodeName} — ${message}`);
      break;
    default:
      logger.error(`OPC UA error: ${statusCodeName} — ${message}`);
  }
  return { category, statusCodeName, message };
}

module.exports = { createClient, wireReconnectEvents, logClassifiedError, DEFAULT_CONNECTION_STRATEGY };

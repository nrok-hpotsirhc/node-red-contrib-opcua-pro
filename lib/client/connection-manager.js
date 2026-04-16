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

module.exports = { createClient, DEFAULT_CONNECTION_STRATEGY };

'use strict';
// WP-C-2: error-handler — OPC UA StatusCode classification and response logic
// See: docs/work-packages.md#wp-c-2-resilience-engineering-session--error-management
// See: docs/theoretical-foundations.md#13-technische-grundlage-node-opcua-bibliothek

/**
 * Error classification categories.
 *   RECONNECT   — Transport/session lost → trigger reconnect loop
 *   NEW_SESSION — Session expired → create new session (old one is gone)
 *   AUTH        — Authentication/certificate failure → do NOT auto-retry
 *   LIMIT       — Server resource limit → log critical, retry with backoff
 *   RECOVERABLE — Transient error → can retry the operation
 *   FATAL       — Unrecoverable → escalate to user
 */
const ErrorCategory = Object.freeze({
  RECONNECT:   'RECONNECT',
  NEW_SESSION: 'NEW_SESSION',
  AUTH:        'AUTH',
  LIMIT:       'LIMIT',
  RECOVERABLE: 'RECOVERABLE',
  FATAL:       'FATAL'
});

/**
 * Map of known OPC UA StatusCode names to error categories.
 * StatusCode.name values from node-opcua (e.g. 'BadSessionClosed').
 */
const STATUS_CODE_MAP = {
  // Session-level failures → create new session
  BadSessionClosed:         ErrorCategory.NEW_SESSION,
  BadSessionIdInvalid:      ErrorCategory.NEW_SESSION,
  BadSessionNotActivated:   ErrorCategory.NEW_SESSION,

  // Transport-level failures → reconnect loop
  BadConnectionClosed:      ErrorCategory.RECONNECT,
  BadServerNotConnected:    ErrorCategory.RECONNECT,
  BadCommunicationError:    ErrorCategory.RECONNECT,
  BadConnectionRejected:    ErrorCategory.RECONNECT,
  BadNotConnected:          ErrorCategory.RECONNECT,
  BadSecureChannelClosed:   ErrorCategory.RECONNECT,
  BadTimeout:               ErrorCategory.RECONNECT,

  // Authentication / certificate failures → do NOT auto-retry
  BadUserAccessDenied:      ErrorCategory.AUTH,
  BadIdentityTokenInvalid:  ErrorCategory.AUTH,
  BadIdentityTokenRejected: ErrorCategory.AUTH,
  BadCertificateUntrusted:  ErrorCategory.AUTH,
  BadCertificateInvalid:    ErrorCategory.AUTH,
  BadCertificateRevoked:    ErrorCategory.AUTH,
  BadCertificateTimeInvalid: ErrorCategory.AUTH,

  // Resource limits → critical log, backoff retry
  BadTooManySessions:       ErrorCategory.LIMIT,
  BadTooManySubscriptions:  ErrorCategory.LIMIT,
  BadTooManyMonitoredItems: ErrorCategory.LIMIT,
  BadOutOfMemory:           ErrorCategory.LIMIT,

  // Recoverable data-level errors
  BadNothingToDo:           ErrorCategory.RECOVERABLE,
  BadServiceUnsupported:    ErrorCategory.FATAL,
  BadNodeIdUnknown:         ErrorCategory.FATAL,
  BadNodeIdInvalid:         ErrorCategory.FATAL,
  BadAttributeIdInvalid:    ErrorCategory.FATAL,
  BadTypeMismatch:          ErrorCategory.FATAL,
  BadWriteNotSupported:     ErrorCategory.FATAL
};

/**
 * Classify an OPC UA error or StatusCode into a category.
 *
 * @param {Error|object} err — Error with .statusCode property, or a StatusCode object itself
 * @returns {{ category: string, statusCodeName: string, message: string }}
 */
function classifyError(err) {
  if (!err) {
    return { category: ErrorCategory.FATAL, statusCodeName: 'Unknown', message: 'Unknown error' };
  }

  // Extract status code name from various formats
  let statusCodeName = 'Unknown';
  if (err.statusCode) {
    statusCodeName = typeof err.statusCode === 'object'
      ? (err.statusCode.name || err.statusCode.toString())
      : String(err.statusCode);
  } else if (err.name && err.name.startsWith('Bad')) {
    statusCodeName = err.name;
  } else if (typeof err.message === 'string') {
    // Try to extract StatusCode from error message
    const match = err.message.match(/\b(Bad[A-Z][a-zA-Z]+)\b/);
    if (match) statusCodeName = match[1];
  }

  const category = STATUS_CODE_MAP[statusCodeName] || ErrorCategory.FATAL;
  const message = err.message || statusCodeName;

  return { category, statusCodeName, message };
}

/**
 * Determine whether an error should trigger auto-retry.
 * Auth errors must NOT be retried (would cause account lockout).
 *
 * @param {string} category — one of ErrorCategory values
 * @returns {boolean}
 */
function shouldRetry(category) {
  return category === ErrorCategory.RECONNECT ||
         category === ErrorCategory.NEW_SESSION ||
         category === ErrorCategory.LIMIT ||
         category === ErrorCategory.RECOVERABLE;
}

module.exports = { ErrorCategory, STATUS_CODE_MAP, classifyError, shouldRetry };

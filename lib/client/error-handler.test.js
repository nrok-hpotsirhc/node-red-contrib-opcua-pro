'use strict';
/**
 * Error Handler — Unit Tests
 * ===========================
 * What is tested here:
 *
 *   The error handler classifies OPC UA StatusCodes into categories that drive
 *   the reconnect / retry / escalation logic in the connection manager and
 *   worker nodes.
 *
 * Why these test cases:
 *   - Session-level errors → NEW_SESSION (must create fresh session)
 *   - Transport-level errors → RECONNECT (trigger reconnect loop)
 *   - Auth errors → AUTH (must NOT auto-retry)
 *   - Resource limit errors → LIMIT (critical log, retry with backoff)
 *   - Fatal errors → FATAL (escalate to user)
 *   - Unknown errors → FATAL (safe default)
 *   - shouldRetry logic for each category
 *   - StatusCode extraction from various error formats
 *
 * See: docs/work-packages.md#wp-c-2 — Resilience Engineering
 */
const assert = require('assert');
const { ErrorCategory, classifyError, shouldRetry } = require('./error-handler');

describe('Error Handler', () => {

  // ── classifyError: session-level ──────────────────────────────────────────

  it('classifies BadSessionClosed as NEW_SESSION', () => {
    const err = { statusCode: { name: 'BadSessionClosed' }, message: 'Session closed' };
    const result = classifyError(err);
    assert.strictEqual(result.category, ErrorCategory.NEW_SESSION);
    assert.strictEqual(result.statusCodeName, 'BadSessionClosed');
  });

  it('classifies BadSessionIdInvalid as NEW_SESSION', () => {
    const err = { statusCode: { name: 'BadSessionIdInvalid' }, message: 'Invalid' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.NEW_SESSION);
  });

  it('classifies BadSessionNotActivated as NEW_SESSION', () => {
    const err = { statusCode: { name: 'BadSessionNotActivated' }, message: 'Not activated' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.NEW_SESSION);
  });

  // ── classifyError: transport-level ────────────────────────────────────────

  it('classifies BadConnectionClosed as RECONNECT', () => {
    const err = { statusCode: { name: 'BadConnectionClosed' }, message: 'Closed' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.RECONNECT);
  });

  it('classifies BadServerNotConnected as RECONNECT', () => {
    const err = { statusCode: { name: 'BadServerNotConnected' }, message: 'Not connected' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.RECONNECT);
  });

  it('classifies BadCommunicationError as RECONNECT', () => {
    const err = { statusCode: { name: 'BadCommunicationError' }, message: 'Comm error' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.RECONNECT);
  });

  it('classifies BadTimeout as RECONNECT', () => {
    const err = { statusCode: { name: 'BadTimeout' }, message: 'Timeout' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.RECONNECT);
  });

  // ── classifyError: auth errors ────────────────────────────────────────────

  it('classifies BadUserAccessDenied as AUTH', () => {
    const err = { statusCode: { name: 'BadUserAccessDenied' }, message: 'Denied' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.AUTH);
  });

  it('classifies BadCertificateUntrusted as AUTH', () => {
    const err = { statusCode: { name: 'BadCertificateUntrusted' }, message: 'Untrusted' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.AUTH);
  });

  it('classifies BadIdentityTokenRejected as AUTH', () => {
    const err = { statusCode: { name: 'BadIdentityTokenRejected' }, message: 'Rejected' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.AUTH);
  });

  // ── classifyError: resource limits ────────────────────────────────────────

  it('classifies BadTooManySessions as LIMIT', () => {
    const err = { statusCode: { name: 'BadTooManySessions' }, message: 'Too many' };
    const result = classifyError(err);
    assert.strictEqual(result.category, ErrorCategory.LIMIT);
  });

  it('classifies BadTooManySubscriptions as LIMIT', () => {
    const err = { statusCode: { name: 'BadTooManySubscriptions' }, message: 'Too many subs' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.LIMIT);
  });

  // ── classifyError: fatal errors ───────────────────────────────────────────

  it('classifies BadNodeIdUnknown as FATAL', () => {
    const err = { statusCode: { name: 'BadNodeIdUnknown' }, message: 'Unknown node' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.FATAL);
  });

  it('classifies BadTypeMismatch as FATAL', () => {
    const err = { statusCode: { name: 'BadTypeMismatch' }, message: 'Mismatch' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.FATAL);
  });

  // ── classifyError: edge cases ─────────────────────────────────────────────

  it('classifies unknown StatusCode as FATAL', () => {
    const err = { statusCode: { name: 'BadSomethingUnknown' }, message: 'Unknown' };
    assert.strictEqual(classifyError(err).category, ErrorCategory.FATAL);
  });

  it('classifies null error as FATAL', () => {
    const result = classifyError(null);
    assert.strictEqual(result.category, ErrorCategory.FATAL);
    assert.strictEqual(result.statusCodeName, 'Unknown');
  });

  it('extracts StatusCode from error message when statusCode property is missing', () => {
    const err = new Error('Operation failed with BadConnectionClosed');
    const result = classifyError(err);
    assert.strictEqual(result.category, ErrorCategory.RECONNECT);
    assert.strictEqual(result.statusCodeName, 'BadConnectionClosed');
  });

  it('extracts StatusCode from error name starting with Bad', () => {
    const err = new Error('test');
    err.name = 'BadSessionClosed';
    const result = classifyError(err);
    assert.strictEqual(result.category, ErrorCategory.NEW_SESSION);
  });

  it('handles statusCode as plain string', () => {
    const err = { statusCode: 'BadTooManySessions', message: 'Limit' };
    const result = classifyError(err);
    assert.strictEqual(result.category, ErrorCategory.LIMIT);
  });

  // ── shouldRetry ───────────────────────────────────────────────────────────

  it('shouldRetry returns true for RECONNECT', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.RECONNECT), true);
  });

  it('shouldRetry returns true for NEW_SESSION', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.NEW_SESSION), true);
  });

  it('shouldRetry returns true for LIMIT', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.LIMIT), true);
  });

  it('shouldRetry returns true for RECOVERABLE', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.RECOVERABLE), true);
  });

  it('shouldRetry returns false for AUTH (must not auto-retry)', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.AUTH), false);
  });

  it('shouldRetry returns false for FATAL', () => {
    assert.strictEqual(shouldRetry(ErrorCategory.FATAL), false);
  });
});

'use strict';
/**
 * Connection Manager — Unit Tests
 * =================================
 * What is tested here:
 *
 *   createClient(config) wraps OPCUAClient.create() with sensible defaults for
 *   industrial use: exponential backoff, SignAndEncrypt with Basic256Sha256,
 *   keepSessionAlive.  These are the safe defaults required by REQ-C-07 and
 *   REQ-C-08.
 *
 *   Since createClient() calls into node-opcua, these tests work at the
 *   boundary: they verify the OPTIONS OBJECT passed to OPCUAClient.create()
 *   rather than the client's internal behavior (which is tested by node-opcua
 *   itself and in integration tests).
 *
 * Why these test cases:
 *   - Default security mode: must be SignAndEncrypt (secure by default)
 *   - Default security policy: must be Basic256Sha256
 *   - keepSessionAlive: must be true (required for auto-healing)
 *   - applicationName: forwarded from config or uses safe fallback
 *   - Custom connectionStrategy: merged over defaults (not replaced)
 *   - DEFAULT_CONNECTION_STRATEGY is exported: so other modules and tests can
 *     import it and verify backoff values without hardcoding them twice
 *   - initialDelay / maxDelay / maxRetry / randomisationFactor: correct defaults
 *
 * Note: we stub OPCUAClient.create() to capture its argument without
 * actually creating a network socket.
 *
 * See: docs/work-packages.md#wp-c-2 — Resilience Engineering
 * See: docs/theoretical-foundations.md#13 — node-opcua Bibliothek
 */
const assert = require('assert');

// ── Stub OPCUAClient.create before requiring our module ───────────────────────
// We capture the options object passed to OPCUAClient.create to verify them.
let capturedOptions = null;
const opcua = require('node-opcua');

const originalCreate = opcua.OPCUAClient.create.bind(opcua.OPCUAClient);

function installStub() {
  opcua.OPCUAClient.create = (opts) => {
    capturedOptions = opts;
    // Return a minimal stub (tests do not call connect/disconnect)
    return { _stub: true };
  };
}

function restoreStub() {
  opcua.OPCUAClient.create = originalCreate;
}

// Install stub so that the require() of connection-manager below captures the
// stubbed version; we restore right after the require so other test files that
// also require('node-opcua') get the real OPCUAClient.create.  The createClient()
// describe block re-installs the stub via before(installStub) before its own tests
// run, which is safe because connection-manager.js already cached its reference
// to the (stubbed) OPCUAClient.create at require time.
installStub();
const { createClient, DEFAULT_CONNECTION_STRATEGY } = require('./connection-manager');
restoreStub();

// ── DEFAULT_CONNECTION_STRATEGY export ───────────────────────────────────────

describe('DEFAULT_CONNECTION_STRATEGY', () => {

  it('exports initialDelay of 1000 ms', () => {
    assert.strictEqual(DEFAULT_CONNECTION_STRATEGY.initialDelay, 1000);
  });

  it('exports maxDelay of 30000 ms', () => {
    assert.strictEqual(DEFAULT_CONNECTION_STRATEGY.maxDelay, 30000);
  });

  it('exports maxRetry as Infinity (never give up)', () => {
    assert.strictEqual(DEFAULT_CONNECTION_STRATEGY.maxRetry, Infinity,
      'Industrial deployments must retry forever until the server returns');
  });

  it('exports randomisationFactor of 0.1 (jitter to avoid thundering-herd)', () => {
    assert.strictEqual(DEFAULT_CONNECTION_STRATEGY.randomisationFactor, 0.1);
  });
});

// ── createClient() — option validation ───────────────────────────────────────

describe('createClient()', () => {

  before(installStub);
  after(restoreStub);

  beforeEach(() => { capturedOptions = null; });

  it('passes applicationName from config to OPCUAClient.create()', () => {
    createClient({ applicationName: 'MyApp' });
    assert.strictEqual(capturedOptions.applicationName, 'MyApp');
  });

  it('uses safe fallback applicationName when config omits it', () => {
    createClient({});
    assert.ok(
      typeof capturedOptions.applicationName === 'string' &&
      capturedOptions.applicationName.length > 0,
      'fallback applicationName must be a non-empty string'
    );
  });

  it('applies SignAndEncrypt as default security mode', () => {
    const { MessageSecurityMode } = require('node-opcua');
    createClient({});
    assert.strictEqual(capturedOptions.securityMode, MessageSecurityMode.SignAndEncrypt,
      'Default security mode must be SignAndEncrypt — never use None in production');
  });

  it('applies Basic256Sha256 as default security policy', () => {
    const { SecurityPolicy } = require('node-opcua');
    createClient({});
    assert.strictEqual(capturedOptions.securityPolicy, SecurityPolicy.Basic256Sha256);
  });

  it('sets keepSessionAlive to true by default', () => {
    createClient({});
    assert.strictEqual(capturedOptions.keepSessionAlive, true,
      'keepSessionAlive must be true for auto-healing reconnect to work');
  });

  it('merges custom connectionStrategy over defaults', () => {
    createClient({ connectionStrategy: { maxRetry: 5 } });
    // maxRetry overridden, but maxDelay should retain default
    assert.strictEqual(capturedOptions.connectionStrategy.maxRetry,  5);
    assert.strictEqual(capturedOptions.connectionStrategy.maxDelay,  DEFAULT_CONNECTION_STRATEGY.maxDelay);
    assert.strictEqual(capturedOptions.connectionStrategy.initialDelay, DEFAULT_CONNECTION_STRATEGY.initialDelay);
  });

  it('forwards certificateFile and privateKeyFile when supplied', () => {
    createClient({ certificateFile: '/pki/cert.pem', privateKeyFile: '/pki/key.pem' });
    assert.strictEqual(capturedOptions.certificateFile, '/pki/cert.pem');
    assert.strictEqual(capturedOptions.privateKeyFile,  '/pki/key.pem');
  });

  it('returns the object produced by OPCUAClient.create()', () => {
    const client = createClient({});
    assert.deepStrictEqual(client, { _stub: true });
  });
});

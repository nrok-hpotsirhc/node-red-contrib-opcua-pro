'use strict';
/**
 * Session Manager — Unit Tests
 * =============================
 * What is tested here:
 *
 *   The session-manager separates session creation/re-establishment from the
 *   raw TCP client (connection-manager).  This is the key mechanism for
 *   REQ-C-07: preventing orphaned sessions on the server when the network
 *   interrupts briefly.
 *
 *   Key functions:
 *     buildUserIdentity(config, credentials)            — maps Node-RED config
 *       to the node-opcua UserIdentityInfo token format
 *     reestablishOrCreateSession(existing, client, id)  — attempts session
 *       reactivation via changeUser(), falls back to createSession()
 *
 * Why these test cases:
 *   - Anonymous auth (default): no credentials object required
 *   - UserName auth: correct userName + password from credentials
 *   - Empty credentials: must not throw (server will reject, not our job)
 *   - Missing authMode field: must default to Anonymous
 *   - reestablish: happy path — changeUser() succeeds, same session returned
 *   - reestablish: changeUser() throws → close old, createSession() called
 *   - reestablish: close of old session fails — must swallow error, still
 *     create new session (server might be unreachable)
 *   - reestablish with null existingSession (first connect): must call
 *     createSession() directly without trying changeUser()
 *
 * See: docs/work-packages.md#wp-c-2 — Resilience Engineering
 * See: docs/theoretical-foundations.md#5 — OPC UA Protokoll-Stack
 */
const assert = require('assert');
const { UserTokenType } = require('node-opcua');
const { buildUserIdentity, reestablishOrCreateSession } = require('./session-manager');

// ── buildUserIdentity ─────────────────────────────────────────────────────────

describe('buildUserIdentity()', () => {

  it('returns Anonymous token when authMode is not set', () => {
    const id = buildUserIdentity({}, {});
    assert.strictEqual(id.type, UserTokenType.Anonymous);
  });

  it('returns Anonymous token when authMode is "Anonymous"', () => {
    const id = buildUserIdentity({ authMode: 'Anonymous' }, {});
    assert.strictEqual(id.type, UserTokenType.Anonymous);
  });

  it('returns UserName token with correct credentials for authMode="UserName"', () => {
    const id = buildUserIdentity(
      { authMode: 'UserName' },
      { username: 'admin', password: 'secret' } // TEST DATA — dummy credentials for unit test only
    );
    assert.strictEqual(id.type,     UserTokenType.UserName);
    assert.strictEqual(id.userName, 'admin');   // TEST DATA
    assert.strictEqual(id.password, 'secret');  // TEST DATA
  });

  it('UserName token with empty credentials defaults to empty strings, does not throw', () => {
    assert.doesNotThrow(() => {
      const id = buildUserIdentity({ authMode: 'UserName' }, {});
      assert.strictEqual(id.userName, '');
      assert.strictEqual(id.password, '');
    });
  });

  it('UserName token with undefined credentials defaults to empty strings', () => {
    const id = buildUserIdentity({ authMode: 'UserName' }, undefined ?? {});
    assert.strictEqual(id.userName, '');
    assert.strictEqual(id.password, '');
  });
});

// ── reestablishOrCreateSession ────────────────────────────────────────────────

describe('reestablishOrCreateSession()', () => {

  const userIdentity = { type: UserTokenType.Anonymous };

  it('reactivates existing session via changeUser() when it succeeds', async () => {
    let changeUserCalled  = false;
    let createSessionCalled = false;

    const existingSession = {
      changeUser: async () => { changeUserCalled = true; }
    };
    const client = {
      createSession: async () => { createSessionCalled = true; return {}; }
    };

    const result = await reestablishOrCreateSession(existingSession, client, userIdentity);

    assert.strictEqual(result, existingSession,
      'On success, the SAME session object must be returned (no server-side growth)');
    assert.ok(changeUserCalled,    'changeUser() must be called for re-establishment');
    assert.ok(!createSessionCalled,'createSession() must NOT be called when reactivation works');
  });

  it('falls back to createSession() when changeUser() throws', async () => {
    const newSession = { id: 'new-session' };
    let closeCalled = false;

    const existingSession = {
      changeUser: async () => { throw new Error('BadSessionExpired'); },
      close:      async () => { closeCalled = true; }
    };
    const client = {
      createSession: async () => newSession
    };

    const result = await reestablishOrCreateSession(existingSession, client, userIdentity);

    assert.strictEqual(result, newSession,
      'Must return the new session when reactivation fails');
    assert.ok(closeCalled,
      'Old session must be closed before creating a new one');
  });

  it('continues to create new session even when close() of old session throws', async () => {
    const newSession = { id: 'new' };

    const existingSession = {
      changeUser: async () => { throw new Error('Expired'); },
      close:      async () => { throw new Error('AlreadyClosed'); }  // close also fails
    };
    const client = {
      createSession: async () => newSession
    };

    // Must not throw — the swallowed close error is acceptable
    const result = await reestablishOrCreateSession(existingSession, client, userIdentity);
    assert.strictEqual(result, newSession);
  });

  it('calls createSession() directly when existingSession is null (first connect)', async () => {
    let createSessionCalled = false;
    const newSession = { id: 'first' };

    const client = {
      createSession: async () => { createSessionCalled = true; return newSession; }
    };

    const result = await reestablishOrCreateSession(null, client, userIdentity);

    assert.ok(createSessionCalled, 'createSession() must be called when there is no existing session');
    assert.strictEqual(result, newSession);
  });

  it('passes the userIdentity token to createSession()', async () => {
    let receivedIdentity;
    const client = {
      createSession: async (id) => { receivedIdentity = id; return {}; }
    };

    await reestablishOrCreateSession(null, client, userIdentity);
    assert.deepStrictEqual(receivedIdentity, userIdentity);
  });
});

'use strict';
// WP-C-2 (M2): Session Manager — OPC UA session creation, re-establishment,
// and subscription reactivation after reconnect.
// See: docs/theoretical-foundations.md#4-sicherheitsarchitektur (session re-establishment)
// See: docs/work-packages.md#wp-c-2-resilience-engineering

const { UserTokenType } = require('node-opcua');

/**
 * Attempt to re-establish an existing OPC UA session after a connection drop.
 *
 * OPC UA servers maintain sessions by SessionId (128-bit NodeId).
 * If the server still holds the session (within session timeout), we can
 * reactivate it via ActivateSession RPC — avoiding server-side session-table growth.
 * If re-establishment fails, fall back to creating a new session.
 *
 * REQ-C-07: Prevent orphaned sessions on server.
 *
 * @param {OPCUAClientSession} existingSession  — previous session (may be inactive)
 * @param {OPCUAClient}        client           — reconnected client transport
 * @param {object}             userIdentity     — {type, userName?, password?}
 * @returns {Promise<OPCUAClientSession>}        — active session (new or reactivated)
 */
async function reestablishOrCreateSession(existingSession, client, userIdentity) {
  if (existingSession) {
    try {
      // node-opcua will attempt ActivateSession before creating a new session.
      // Providing the existing session object signals the reuse intent.
      await existingSession.changeUser(userIdentity);
      return existingSession;
    } catch (_reactivateErr) {
      // Session expired on server side — close gracefully and create fresh
      try { await existingSession.close(); } catch (_) { /* ignore */ }
    }
  }
  return client.createSession(userIdentity);
}

/**
 * Reactivate existing subscriptions after a successful reconnect.
 *
 * After session re-establishment, subscriptions may still exist on the server.
 * We attempt to re-enable publishing on each. If a subscription is gone
 * (e.g. because the server cleaned it up), the caller should recreate it.
 *
 * @param {Array<ClientSubscription>} subscriptions — existing subscription objects
 * @param {object} logger — Node-RED node logger
 * @returns {Promise<{ active: Array, expired: Array }>}
 */
async function reactivateSubscriptions(subscriptions, logger) {
  const active  = [];
  const expired = [];

  for (const sub of subscriptions) {
    try {
      // Re-enable publishing mode — if the subscription still exists on the server,
      // this will succeed and data will flow again.
      await sub.setPublishingMode(true);
      active.push(sub);
    } catch (err) {
      // Subscription was removed by server during disconnect
      if (logger) logger.warn(`Subscription reactivation failed: ${err.message} — marked as expired`);
      expired.push(sub);
    }
  }

  return { active, expired };
}

/**
 * Build a user identity token from node config + decrypted credentials.
 *
 * @param {object} config       — Node-RED config object (config.authMode)
 * @param {object} credentials  — Node-RED credentials (username, password)
 * @returns {object}            — node-opcua UserIdentityInfo
 */
function buildUserIdentity(config, credentials) {
  if (config.authMode === 'UserName') {
    return {
      type:     UserTokenType.UserName,
      userName: credentials.username || '',
      password: credentials.password || ''
    };
  }
  // Certificate auth: WP-C-5 (M5)
  return { type: UserTokenType.Anonymous };
}

module.exports = { reestablishOrCreateSession, reactivateSubscriptions, buildUserIdentity };

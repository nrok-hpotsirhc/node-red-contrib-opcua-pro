'use strict';
// WP-S-6 (M7): User Manager for OPC UA Server Username/Password authentication.
// Parses the encrypted users JSON from Node-RED credentials and exposes the
// { isValidUser, getUserRole } interface expected by node-opcua.
// See: docs/work-packages.md#wp-s-6-server-security--identity-configuration

const DEFAULT_ROLE = 'AuthenticatedUser';

/**
 * Parse the users spec coming from the Node-RED credentials field.
 * Accepts either a JSON string or an already-parsed array. Invalid entries
 * (missing username/password or wrong types) are silently dropped so a
 * malformed entry never breaks the whole server.
 *
 * @param {string|Array|undefined|null} raw
 * @returns {{ username: string, password: string, role: string }[]}
 */
function parseUsers(raw) {
  if (!raw) return [];
  let parsed;
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(u => u && typeof u.username === 'string' && typeof u.password === 'string' && u.username.length > 0)
    .map(u => ({
      username: u.username,
      password: u.password,
      role:     typeof u.role === 'string' && u.role.length > 0 ? u.role : DEFAULT_ROLE
    }));
}

/**
 * Constant-time string comparison — prevents timing side-channel attacks on
 * password comparison. Returns false if lengths differ (also in constant time
 * for the shorter string).
 */
function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Build the user-manager object consumed by node-opcua.
 * Returns an object exposing `isValidUser` and `getUserRole`.
 *
 * @param {Array} users — output of parseUsers()
 * @returns {{ isValidUser: Function, getUserRole: Function, size: number }}
 */
function createUserManager(users) {
  const list = Array.isArray(users) ? users : [];

  return {
    size: list.length,
    isValidUser(username, password) {
      const entry = list.find(u => u.username === username);
      if (!entry) return false;
      return constantTimeEquals(entry.password, String(password ?? ''));
    },
    getUserRole(username) {
      const entry = list.find(u => u.username === username);
      return entry ? entry.role : 'Anonymous';
    }
  };
}

/**
 * Convenience: build a user-manager directly from the raw credentials value.
 * Returns null when no users are configured, so callers can decide whether to
 * pass a user-manager to OPCUAServer at all.
 */
function buildUserManagerFromCredentials(rawUsers) {
  const users = parseUsers(rawUsers);
  if (users.length === 0) return null;
  return createUserManager(users);
}

module.exports = {
  parseUsers,
  createUserManager,
  buildUserManagerFromCredentials,
  constantTimeEquals,
  DEFAULT_ROLE
};

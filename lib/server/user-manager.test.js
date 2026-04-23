'use strict';
/**
 * User Manager — Unit Tests
 * ==========================
 * WP-S-6 (M7): Verifies username/password parsing, role handling, constant-time
 * password comparison, and the node-opcua compatible { isValidUser, getUserRole }
 * interface.
 *
 * See: docs/work-packages.md#wp-s-6-server-security--identity-configuration
 */
const assert = require('assert');
const {
  parseUsers,
  createUserManager,
  buildUserManagerFromCredentials,
  constantTimeEquals,
  DEFAULT_ROLE
} = require('./user-manager');

describe('parseUsers()', () => {

  it('returns empty array for null/undefined/empty string', () => {
    assert.deepStrictEqual(parseUsers(null), []);
    assert.deepStrictEqual(parseUsers(undefined), []);
    assert.deepStrictEqual(parseUsers(''), []);
  });

  it('returns empty array for invalid JSON', () => {
    assert.deepStrictEqual(parseUsers('{not-json'), []);
  });

  it('returns empty array for non-array JSON', () => {
    assert.deepStrictEqual(parseUsers('{"username":"a","password":"b"}'), []);
  });

  it('returns empty array for non-string/non-array input types', () => {
    assert.deepStrictEqual(parseUsers(42), []);
    assert.deepStrictEqual(parseUsers({}), []);
    assert.deepStrictEqual(parseUsers(true), []);
  });

  it('accepts an already-parsed array', () => {
    const users = parseUsers([
      { username: 'admin', password: 'secret' } // TEST DATA
    ]);
    assert.strictEqual(users.length, 1);
    assert.strictEqual(users[0].username, 'admin');
  });

  it('parses valid JSON string with multiple users', () => {
    const json = JSON.stringify([
      { username: 'admin', password: 'secret', role: 'Engineer' }, // TEST DATA
      { username: 'op',    password: 'op123' }                      // TEST DATA
    ]);
    const users = parseUsers(json);
    assert.strictEqual(users.length, 2);
    assert.strictEqual(users[0].role, 'Engineer');
  });

  it('applies DEFAULT_ROLE when role is missing or empty', () => {
    const users = parseUsers([
      { username: 'a', password: 'p' },             // TEST DATA
      { username: 'b', password: 'p', role: '' },   // TEST DATA
      { username: 'c', password: 'p', role: 'Op' }  // TEST DATA
    ]);
    assert.strictEqual(users[0].role, DEFAULT_ROLE);
    assert.strictEqual(users[1].role, DEFAULT_ROLE);
    assert.strictEqual(users[2].role, 'Op');
  });

  it('drops entries missing username or password', () => {
    const users = parseUsers([
      { username: 'a', password: 'p' },            // TEST DATA — kept
      { username: '',  password: 'p' },            // TEST DATA — dropped (empty username)
      { username: 'b' },                            // TEST DATA — dropped (no password)
      { password: 'p' },                            // TEST DATA — dropped (no username)
      null,                                         // TEST DATA — dropped
      { username: 42, password: 'p' }               // TEST DATA — dropped (wrong type)
    ]);
    assert.strictEqual(users.length, 1);
    assert.strictEqual(users[0].username, 'a');
  });
});

describe('createUserManager()', () => {

  it('exposes isValidUser and getUserRole as functions', () => {
    const um = createUserManager([]);
    assert.strictEqual(typeof um.isValidUser, 'function');
    assert.strictEqual(typeof um.getUserRole, 'function');
  });

  it('isValidUser returns true for matching username/password', () => {
    const um = createUserManager([{ username: 'admin', password: 'secret', role: 'Engineer' }]); // TEST DATA
    assert.strictEqual(um.isValidUser('admin', 'secret'), true);
  });

  it('isValidUser returns false for wrong password', () => {
    const um = createUserManager([{ username: 'admin', password: 'secret', role: 'Engineer' }]); // TEST DATA
    assert.strictEqual(um.isValidUser('admin', 'wrong'), false);
  });

  it('isValidUser returns false for unknown user', () => {
    const um = createUserManager([{ username: 'admin', password: 'secret' }]); // TEST DATA
    assert.strictEqual(um.isValidUser('unknown', 'secret'), false);
  });

  it('isValidUser returns false when called on empty user list', () => {
    const um = createUserManager([]);
    assert.strictEqual(um.isValidUser('any', 'any'), false);
  });

  it('isValidUser handles null/undefined password without throwing', () => {
    const um = createUserManager([{ username: 'admin', password: 'secret' }]); // TEST DATA
    assert.strictEqual(um.isValidUser('admin', null), false);
    assert.strictEqual(um.isValidUser('admin', undefined), false);
  });

  it('getUserRole returns configured role for known user', () => {
    const um = createUserManager([{ username: 'op', password: 'p', role: 'Operator' }]); // TEST DATA
    assert.strictEqual(um.getUserRole('op'), 'Operator');
  });

  it('getUserRole returns Anonymous for unknown user', () => {
    const um = createUserManager([{ username: 'op', password: 'p' }]); // TEST DATA
    assert.strictEqual(um.getUserRole('unknown'), 'Anonymous');
  });

  it('exposes size of the user list', () => {
    const um = createUserManager([
      { username: 'a', password: 'p' }, // TEST DATA
      { username: 'b', password: 'p' }  // TEST DATA
    ]);
    assert.strictEqual(um.size, 2);
  });
});

describe('constantTimeEquals()', () => {

  it('returns true for identical strings', () => {
    assert.strictEqual(constantTimeEquals('hello', 'hello'), true); // TEST DATA
  });

  it('returns false for different strings of same length', () => {
    assert.strictEqual(constantTimeEquals('hello', 'world'), false); // TEST DATA
  });

  it('returns false for strings of different length', () => {
    assert.strictEqual(constantTimeEquals('hi', 'hello'), false); // TEST DATA
  });

  it('returns false for non-string inputs', () => {
    assert.strictEqual(constantTimeEquals(42, 42), false);
    assert.strictEqual(constantTimeEquals('a', null), false);
    assert.strictEqual(constantTimeEquals(undefined, 'a'), false);
  });

  it('returns true for two empty strings', () => {
    assert.strictEqual(constantTimeEquals('', ''), true);
  });
});

describe('buildUserManagerFromCredentials()', () => {

  it('returns null for empty credentials', () => {
    assert.strictEqual(buildUserManagerFromCredentials(null), null);
    assert.strictEqual(buildUserManagerFromCredentials(''), null);
    assert.strictEqual(buildUserManagerFromCredentials('[]'), null);
  });

  it('returns a user-manager for valid credentials', () => {
    const um = buildUserManagerFromCredentials(
      JSON.stringify([{ username: 'admin', password: 'secret' }]) // TEST DATA
    );
    assert.ok(um);
    assert.strictEqual(um.isValidUser('admin', 'secret'), true);
  });
});

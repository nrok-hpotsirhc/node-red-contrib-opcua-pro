'use strict';
/**
 * Server PKI Manager — Unit Tests (WP-S-5)
 * ==========================================
 * Tests for server-side certificate management, mirroring client-side PKI tests.
 *
 * What is tested:
 *   - Server PKI directory creation (ensureServerPkiDirectories)
 *   - List rejected client certificates
 *   - Trust client certificate (atomic move)
 *   - List trusted client certificates
 *   - Path traversal prevention in all filename operations
 *   - Certificate file auto-generation (ensureServerCertificate)
 *
 * See: docs/work-packages.md#wp-s-5 — Server PKI & RBAC
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const {
  ensureServerPkiDirectories,
  ensureServerCertificate,
  listRejectedClientCertificates,
  trustClientCertificate,
  listTrustedClientCertificates
} = require('./pki-manager');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePkiRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'server-pki-test-'));
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Server PKI Manager (WP-S-5)', () => {

  let pkiRoot;

  beforeEach(() => {
    pkiRoot = makePkiRoot();
  });

  afterEach(() => {
    fs.rmSync(pkiRoot, { recursive: true, force: true });
  });

  // ── Directory creation ────────────────────────────────────────────────────

  it('creates all five required server PKI subdirectories', () => {
    ensureServerPkiDirectories(pkiRoot);

    const expected = [
      'own/certs', 'own/private', 'trusted/certs', 'rejected', 'issuers/certs'
    ];
    expected.forEach(sub => {
      assert.ok(
        fs.existsSync(path.join(pkiRoot, sub)),
        `Server PKI subdirectory "${sub}" must exist`
      );
    });
  });

  it('ensureServerPkiDirectories is idempotent', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.doesNotThrow(() => ensureServerPkiDirectories(pkiRoot));
  });

  // ── Auto-generate certificate ────────────────────────────────────────────

  it('ensureServerCertificate generates a certificate on first call', async () => {
    const result = await ensureServerCertificate(pkiRoot, 'TestServer', 4840);
    assert.ok(result.certFile, 'certFile must be returned');
    assert.ok(result.keyFile, 'keyFile must be returned');
    assert.ok(fs.existsSync(result.certFile), 'Certificate file must exist');
    assert.ok(fs.existsSync(result.keyFile), 'Private key file must exist');
  });

  it('ensureServerCertificate is idempotent — second call returns same cert', async () => {
    const first  = await ensureServerCertificate(pkiRoot, 'TestServer', 4840);
    const second = await ensureServerCertificate(pkiRoot, 'TestServer', 4840);
    assert.strictEqual(first.certFile, second.certFile,
      'Same cert file should be returned on subsequent calls');
  });

  // ── List rejected client certificates ─────────────────────────────────────

  it('listRejectedClientCertificates returns empty array initially', () => {
    ensureServerPkiDirectories(pkiRoot);
    const list = listRejectedClientCertificates(pkiRoot);
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 0);
  });

  it('listRejectedClientCertificates returns placed certificates', () => {
    ensureServerPkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'client1.der'), 'cert-data'); // TEST DATA
    const list = listRejectedClientCertificates(pkiRoot);
    assert.ok(list.includes('client1.der'));
  });

  // ── Trust client certificate ──────────────────────────────────────────────

  it('trustClientCertificate moves file from rejected/ to trusted/certs/', () => {
    ensureServerPkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'client.der'), 'cert-data'); // TEST DATA

    trustClientCertificate(pkiRoot, 'client.der');

    assert.strictEqual(
      fs.existsSync(path.join(pkiRoot, 'rejected', 'client.der')),
      false, 'Must be REMOVED from rejected/'
    );
    assert.strictEqual(
      fs.existsSync(path.join(pkiRoot, 'trusted', 'certs', 'client.der')),
      true, 'Must APPEAR in trusted/certs/'
    );
  });

  it('trusted certificate retains original content', () => {
    ensureServerPkiDirectories(pkiRoot);
    const content = 'binary-cert-content-test'; // TEST DATA
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'c.der'), content);

    trustClientCertificate(pkiRoot, 'c.der');

    const actual = fs.readFileSync(path.join(pkiRoot, 'trusted', 'certs', 'c.der'), 'utf8');
    assert.strictEqual(actual, content);
  });

  // ── List trusted client certificates ──────────────────────────────────────

  it('listTrustedClientCertificates returns empty when no certs trusted', () => {
    ensureServerPkiDirectories(pkiRoot);
    const list = listTrustedClientCertificates(pkiRoot);
    assert.strictEqual(list.length, 0);
  });

  it('listTrustedClientCertificates returns trusted certs after trust operation', () => {
    ensureServerPkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'c2.der'), 'data'); // TEST DATA
    trustClientCertificate(pkiRoot, 'c2.der');
    const list = listTrustedClientCertificates(pkiRoot);
    assert.ok(list.includes('c2.der'));
  });

  // ── Security: path traversal prevention ──────────────────────────────────

  it('rejects path traversal with ".."', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.throws(
      () => trustClientCertificate(pkiRoot, '../evil.der'),
      /Invalid certificate filename/
    );
  });

  it('rejects forward slash in filename', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.throws(
      () => trustClientCertificate(pkiRoot, 'sub/dir.der'),
      /Invalid certificate filename/
    );
  });

  it('rejects backslash in filename', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.throws(
      () => trustClientCertificate(pkiRoot, 'sub\\dir.der'),
      /Invalid certificate filename/
    );
  });

  it('rejects empty filename', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.throws(
      () => trustClientCertificate(pkiRoot, ''),
      /Invalid certificate filename/
    );
  });

  it('throws when file does not exist in rejected/', () => {
    ensureServerPkiDirectories(pkiRoot);
    assert.throws(
      () => trustClientCertificate(pkiRoot, 'nonexistent.der'),
      /Certificate not found/
    );
  });
});

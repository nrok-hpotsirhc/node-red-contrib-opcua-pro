'use strict';
/**
 * PKI Manager — Comprehensive Unit Tests
 * =======================================
 * What is tested here:
 *
 *   The PKI Manager controls the X.509 Public Key Infrastructure directory
 *   layout that node-opcua expects.  It also implements the trust workflow used
 *   by the Security Dashboard in the Node-RED editor (REQ-C-08, REQ-C-09).
 *
 *   Key functions:
 *     ensurePkiDirectories(pkiRoot)         — idempotently creates all PKI dirs
 *     ensureClientCertificate(root, name)   — auto-generates X.509 cert if missing
 *     listRejectedCertificates(root)        — returns filenames in rejected/
 *     trustCertificate(root, filename)      — moves cert: rejected/ → trusted/certs/
 *     listTrustedCertificates(root)         — returns filenames in trusted/certs/
 *
 * Why these test cases:
 *   - Directory creation: all five required subdirs must exist after one call
 *   - Idempotency: calling twice must not throw (dirs already exist = no error)
 *   - Certificate generation: first call creates cert+key, second call is no-op
 *   - List empty: returns [] when rejected/ is empty (fresh PKI)
 *   - List with certs: returned array contains expected filenames
 *   - Atomic move: file disappears from rejected/ AND appears in trusted/certs/
 *   - Path traversal ('..'): must throw "Invalid certificate filename"
 *   - Slash in filename: must throw (prevents escaping into other directories)
 *   - Backslash in filename: must throw (Windows path separator injection)
 *   - Empty filename: must throw
 *   - File that does not exist in rejected/: must throw ENOENT from fs.renameSync
 *
 * Security contract: trustCertificate must NEVER move a file outside of
 *   <pkiRoot>/rejected/ to <pkiRoot>/trusted/certs/ — this is enforced by the
 *   regex /^[\w\-]+\.(der|pem)$/ which rejects any meta characters.
 *
 * See: docs/work-packages.md#wp-c-5 — Security & PKI UI
 * See: docs/theoretical-foundations.md#4 — Sicherheitsarchitektur
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const {
  ensurePkiDirectories,
  ensureClientCertificate,
  listRejectedCertificates,
  trustCertificate,
  listTrustedCertificates
} = require('./pki-manager');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePkiRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pki-test-'));
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('PKI Manager', () => {

  let pkiRoot;

  beforeEach(() => {
    pkiRoot = makePkiRoot();
  });

  afterEach(() => {
    fs.rmSync(pkiRoot, { recursive: true, force: true });
  });

  // ── Directory creation ────────────────────────────────────────────────────

  it('creates all five required PKI subdirectories', () => {
    ensurePkiDirectories(pkiRoot);

    const expected = [
      'own/certs',
      'own/private',
      'trusted/certs',
      'rejected',
      'issuers/certs'
    ];
    expected.forEach(sub => {
      assert.ok(
        fs.existsSync(path.join(pkiRoot, sub)),
        `PKI subdirectory "${sub}" must exist after ensurePkiDirectories()`
      );
    });
  });

  it('ensurePkiDirectories is idempotent — calling twice does not throw', () => {
    ensurePkiDirectories(pkiRoot);
    assert.doesNotThrow(() => ensurePkiDirectories(pkiRoot),
      'Second call must not throw when directories already exist');
  });

  // ── List rejected certificates ────────────────────────────────────────────

  it('listRejectedCertificates returns empty array when no certs present', () => {
    ensurePkiDirectories(pkiRoot);
    const list = listRejectedCertificates(pkiRoot);
    assert.ok(Array.isArray(list), 'Must return an array');
    assert.strictEqual(list.length, 0, 'Empty rejected/ must produce empty array');
  });

  it('listRejectedCertificates returns filename of a placed certificate', () => {
    ensurePkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'server.der'), 'dummy-cert'); // TEST DATA
    const list = listRejectedCertificates(pkiRoot);
    assert.ok(list.includes('server.der'), '"server.der" must appear in the list');
  });

  it('listRejectedCertificates returns multiple filenames when multiple certs exist', () => {
    ensurePkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'server1.der'), 'cert1'); // TEST DATA
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'server2.der'), 'cert2'); // TEST DATA
    const list = listRejectedCertificates(pkiRoot);
    assert.strictEqual(list.length, 2);
    assert.ok(list.includes('server1.der'));
    assert.ok(list.includes('server2.der'));
  });

  // ── Trust certificate ─────────────────────────────────────────────────────

  it('trustCertificate moves file from rejected/ to trusted/certs/', () => {
    ensurePkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'server.der'), 'cert-content'); // TEST DATA

    trustCertificate(pkiRoot, 'server.der');

    const srcExists  = fs.existsSync(path.join(pkiRoot, 'rejected',     'server.der'));
    const destExists = fs.existsSync(path.join(pkiRoot, 'trusted/certs','server.der'));
    assert.strictEqual(srcExists,  false, 'Cert must be REMOVED from rejected/');
    assert.strictEqual(destExists, true,  'Cert must APPEAR in trusted/certs/');
  });

  it('trusted certificate retains original byte content', () => {
    ensurePkiDirectories(pkiRoot);
    const originalContent = 'binary-cert-data-xyz'; // TEST DATA
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'srv.der'), originalContent);

    trustCertificate(pkiRoot, 'srv.der');

    const content = fs.readFileSync(path.join(pkiRoot, 'trusted/certs', 'srv.der'), 'utf8');
    assert.strictEqual(content, originalContent, 'File content must be preserved after move');
  });

  // ── Security: path traversal prevention ──────────────────────────────────

  it('trustCertificate rejects "../evil.der" path traversal', () => {
    ensurePkiDirectories(pkiRoot);
    assert.throws(
      () => trustCertificate(pkiRoot, '../evil.der'),
      /Invalid certificate filename/,
      'Path traversal via ".." must throw'
    );
  });

  it('trustCertificate rejects filename containing forward slash', () => {
    ensurePkiDirectories(pkiRoot);
    assert.throws(
      () => trustCertificate(pkiRoot, 'sub/dir.der'),
      /Invalid certificate filename/,
      'Forward slash in filename must throw'
    );
  });

  it('trustCertificate rejects filename containing backslash', () => {
    ensurePkiDirectories(pkiRoot);
    assert.throws(
      () => trustCertificate(pkiRoot, 'sub\\dir.der'),
      /Invalid certificate filename/,
      'Backslash in filename must throw'
    );
  });

  it('trustCertificate rejects empty filename', () => {
    ensurePkiDirectories(pkiRoot);
    assert.throws(
      () => trustCertificate(pkiRoot, ''),
      /Invalid certificate filename/,
      'Empty filename must throw'
    );
  });

  it('trustCertificate throws when file does not exist in rejected/', () => {
    ensurePkiDirectories(pkiRoot);
    assert.throws(
      () => trustCertificate(pkiRoot, 'nonexistent.der'),
      /Certificate not found|ENOENT/,
      'Non-existent file must throw an error'
    );
  });

  // ── Auto-generate certificate (WP-C-5: D-C-5.1) ────────────────────────

  it('ensureClientCertificate generates a certificate on first call', async () => {
    const result = await ensureClientCertificate(pkiRoot, 'TestClient');
    assert.ok(result.certFile, 'certFile must be returned');
    assert.ok(result.keyFile, 'keyFile must be returned');
    assert.ok(fs.existsSync(result.certFile), 'Certificate file must exist on disk');
    assert.ok(fs.existsSync(result.keyFile), 'Private key file must exist on disk');
  });

  it('ensureClientCertificate is idempotent — second call reuses existing cert', async () => {
    const first  = await ensureClientCertificate(pkiRoot, 'TestClient');
    const second = await ensureClientCertificate(pkiRoot, 'TestClient');
    assert.strictEqual(first.certFile, second.certFile,
      'Same certificate path must be returned on second call');
  });

  // ── List trusted certificates ─────────────────────────────────────────────

  it('listTrustedCertificates returns empty array initially', () => {
    ensurePkiDirectories(pkiRoot);
    const list = listTrustedCertificates(pkiRoot);
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 0);
  });

  it('listTrustedCertificates returns certs after trust operation', () => {
    ensurePkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'srv.der'), 'data'); // TEST DATA
    trustCertificate(pkiRoot, 'srv.der');
    const list = listTrustedCertificates(pkiRoot);
    assert.ok(list.includes('srv.der'), 'Trusted cert must appear in list');
  });

  it('trusted cert no longer appears in rejected list', () => {
    ensurePkiDirectories(pkiRoot);
    fs.writeFileSync(path.join(pkiRoot, 'rejected', 'srv2.der'), 'data'); // TEST DATA
    trustCertificate(pkiRoot, 'srv2.der');
    const rejectedList = listRejectedCertificates(pkiRoot);
    assert.ok(!rejectedList.includes('srv2.der'),
      'Trusted cert must NOT appear in rejected list');
  });
});

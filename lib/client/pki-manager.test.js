'use strict';
// WP-C-5: pki-manager unit tests
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { ensurePkiDirectories, listRejectedCertificates, trustCertificate } = require('../../lib/client/pki-manager');

describe('PKI Manager', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all required PKI subdirectories', () => {
    ensurePkiDirectories(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, 'own/certs')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'own/private')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'trusted/certs')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'rejected')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'issuers/certs')));
  });

  it('lists rejected certificates', () => {
    ensurePkiDirectories(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'rejected', 'server.der'), 'dummy');
    const list = listRejectedCertificates(tmpDir);
    assert.ok(list.includes('server.der'));
  });

  it('moves rejected cert to trusted/certs atomically', () => {
    ensurePkiDirectories(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'rejected', 'server.der'), 'dummy');

    trustCertificate(tmpDir, 'server.der');

    assert.ok(!fs.existsSync(path.join(tmpDir, 'rejected', 'server.der')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'trusted/certs', 'server.der')));
  });

  it('rejects path traversal attempts in trustCertificate', () => {
    ensurePkiDirectories(tmpDir);
    assert.throws(
      () => trustCertificate(tmpDir, '../evil.der'),
      /Invalid certificate filename/
    );
  });
});

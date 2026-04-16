'use strict';
// WP-C-5: pki-manager — Client certificate management.
// Delegates all implementation to lib/pki-base.js (shared with server PKI).
// See: docs/work-packages.md#wp-c-5-security--pki-ui

const path = require('path');
const {
  ensurePkiDirectories,
  ensureSelfSignedCertificate,
  listCertificatesInDir,
  trustCertificateInStore
} = require('../pki-base');

const ensureClientCertificate   = (pkiDir, applicationName) => ensureSelfSignedCertificate(pkiDir, applicationName);
const listRejectedCertificates  = (pkiDir) => listCertificatesInDir(path.join(pkiDir, 'rejected'));
const trustCertificate          = (pkiDir, filename) => trustCertificateInStore(pkiDir, filename);
const listTrustedCertificates   = (pkiDir) => listCertificatesInDir(path.join(pkiDir, 'trusted', 'certs'));

module.exports = {
  ensurePkiDirectories,
  ensureClientCertificate,
  listRejectedCertificates,
  trustCertificate,
  listTrustedCertificates
};

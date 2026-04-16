'use strict';
// WP-S-5: Server PKI Manager — Certificate management for OPC UA Server.
// Delegates all implementation to lib/pki-base.js (shared with client PKI).
// See: docs/work-packages.md#wp-s-5-server-pki--rbac

const path = require('path');
const {
  ensurePkiDirectories,
  ensureSelfSignedCertificate,
  listCertificatesInDir,
  trustCertificateInStore
} = require('../pki-base');

const ensureServerCertificate          = (pkiDir, productName) => ensureSelfSignedCertificate(pkiDir, productName);
const listRejectedClientCertificates   = (pkiDir) => listCertificatesInDir(path.join(pkiDir, 'rejected'));
const trustClientCertificate           = (pkiDir, filename) => trustCertificateInStore(pkiDir, filename);
const listTrustedClientCertificates    = (pkiDir) => listCertificatesInDir(path.join(pkiDir, 'trusted', 'certs'));

module.exports = {
  ensureServerPkiDirectories: ensurePkiDirectories,
  ensureServerCertificate,
  listRejectedClientCertificates,
  trustClientCertificate,
  listTrustedClientCertificates
};

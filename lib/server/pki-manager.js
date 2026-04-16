'use strict';
// WP-S-5: Server PKI Manager — Certificate management for OPC UA Server
// See: docs/work-packages.md#wp-s-5-server-pki--rbac
// See: docs/theoretical-foundations.md#44-pki-und-x509-zertifikate

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { CertificateManager } = require('node-opcua-certificate-manager');

const PKI_SUBDIRS = [
  'own/certs',
  'own/private',
  'trusted/certs',
  'rejected',
  'issuers/certs'
];

/**
 * Idempotently create all required server PKI subdirectories.
 * @param {string} pkiDir — Root of the server PKI folder
 */
function ensureServerPkiDirectories(pkiDir) {
  for (const subdir of PKI_SUBDIRS) {
    fs.mkdirSync(path.join(pkiDir, subdir), { recursive: true });
  }
}

/**
 * Ensure a self-signed X.509 application certificate exists for the server.
 * Uses node-opcua CertificateManager for proper OPC UA compliant certificate generation.
 *
 * @param {string} pkiDir      — Root PKI directory (e.g. <userDir>/opcua-pki/server)
 * @param {string} productName — Human-readable product name for the Subject CN
 * @param {number} [port=4840] — Server port (included in DNS/IP SAN for endpoint discovery)
 * @returns {{ certFile: string, keyFile: string }}
 */
async function ensureServerCertificate(pkiDir, productName, port) {
  ensureServerPkiDirectories(pkiDir);

  const certDir = path.join(pkiDir, 'own', 'certs');
  const keyDir  = path.join(pkiDir, 'own', 'private');

  // Look for any existing certificate
  const existingCerts = fs.readdirSync(certDir)
    .filter(f => f.endsWith('.pem') || f.endsWith('.der'));

  if (existingCerts.length > 0) {
    const certFile = path.join(certDir, existingCerts[0]);
    const existingKeys = fs.readdirSync(keyDir).filter(f => f.endsWith('.pem'));
    const keyFile = existingKeys.length > 0
      ? path.join(keyDir, existingKeys[0])
      : path.join(keyDir, 'private_key.pem');
    return { certFile, keyFile };
  }

  // Generate self-signed certificate
  const cm = new CertificateManager({ location: pkiDir });
  await cm.initialize();

  const appUri = `urn:${os.hostname()}:NodeRED:${productName.replace(/\s+/g, '')}`;

  await cm.createSelfSignedCertificate({
    applicationUri: appUri,
    subject:        `/CN=${productName}/O=NodeRED/C=DE`,
    dns:            [os.hostname(), 'localhost'],
    validity:       3650,
    startDate:      new Date()
  });

  await cm.dispose();

  // Find generated files
  const certs = fs.readdirSync(certDir).filter(f => f.endsWith('.pem') || f.endsWith('.der'));
  const keys  = fs.readdirSync(keyDir).filter(f => f.endsWith('.pem'));

  const certFile = path.join(certDir, certs[0]);
  const keyFile  = path.join(keyDir, keys[0]);

  return { certFile, keyFile };
}

/**
 * List all rejected (untrusted) client certificate filenames on the server.
 * @param {string} pkiDir
 * @returns {string[]}
 */
function listRejectedClientCertificates(pkiDir) {
  const rejectedDir = path.join(pkiDir, 'rejected');
  if (!fs.existsSync(rejectedDir)) return [];
  return fs.readdirSync(rejectedDir)
    .filter(f => f.endsWith('.der') || f.endsWith('.pem'));
}

/**
 * Move a client certificate from rejected/ to trusted/certs/ using atomic fs.renameSync.
 * Validates the filename to prevent path traversal attacks.
 *
 * @param {string} pkiDir   — Root server PKI directory
 * @param {string} filename — Name of the certificate file
 */
function trustClientCertificate(pkiDir, filename) {
  if (!/^[\w\-]+\.(der|pem)$/.test(filename)) {
    throw new Error(`Invalid certificate filename: ${filename}`);
  }

  const src  = path.join(pkiDir, 'rejected',      filename);
  const dest = path.join(pkiDir, 'trusted', 'certs', filename);

  if (!fs.existsSync(src)) {
    throw new Error(`Certificate not found in rejected store: ${filename}`);
  }

  // Atomic move — never copy+delete
  fs.renameSync(src, dest);
}

/**
 * List all trusted client certificate filenames.
 * @param {string} pkiDir
 * @returns {string[]}
 */
function listTrustedClientCertificates(pkiDir) {
  const trustedDir = path.join(pkiDir, 'trusted', 'certs');
  if (!fs.existsSync(trustedDir)) return [];
  return fs.readdirSync(trustedDir)
    .filter(f => f.endsWith('.der') || f.endsWith('.pem'));
}

module.exports = {
  ensureServerPkiDirectories,
  ensureServerCertificate,
  listRejectedClientCertificates,
  trustClientCertificate,
  listTrustedClientCertificates
};

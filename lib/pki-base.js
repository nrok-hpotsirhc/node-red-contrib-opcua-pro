'use strict';
// Shared PKI utilities used by both lib/client/pki-manager.js and lib/server/pki-manager.js.
// Single source of truth for certificate directory layout, generation, and trust workflow.
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
 * Idempotently create all required PKI subdirectories.
 * @param {string} pkiDir — Root of the PKI folder structure
 */
function ensurePkiDirectories(pkiDir) {
  for (const subdir of PKI_SUBDIRS) {
    fs.mkdirSync(path.join(pkiDir, subdir), { recursive: true });
  }
}

/**
 * Ensure a self-signed X.509 application certificate exists.
 * If none exists yet, one is generated automatically via node-opcua CertificateManager.
 *
 * @param {string} pkiDir          — Root PKI directory
 * @param {string} applicationName — Human-readable application name for the Subject CN
 * @returns {Promise<{ certFile: string, keyFile: string }>}
 */
async function ensureSelfSignedCertificate(pkiDir, applicationName) {
  ensurePkiDirectories(pkiDir);

  const certDir = path.join(pkiDir, 'own', 'certs');
  const keyDir  = path.join(pkiDir, 'own', 'private');

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

  const cm = new CertificateManager({ location: pkiDir });
  await cm.initialize();

  const appUri = `urn:${os.hostname()}:NodeRED:${applicationName.replace(/\s+/g, '')}`;

  await cm.createSelfSignedCertificate({
    applicationUri: appUri,
    subject:        `/CN=${applicationName}/O=NodeRED/C=DE`,
    dns:            [os.hostname(), 'localhost'],
    validity:       3650,
    startDate:      new Date()
  });

  await cm.dispose();

  const certs = fs.readdirSync(certDir).filter(f => f.endsWith('.pem') || f.endsWith('.der'));
  const keys  = fs.readdirSync(keyDir).filter(f => f.endsWith('.pem'));

  return {
    certFile: path.join(certDir, certs[0]),
    keyFile:  path.join(keyDir, keys[0])
  };
}

/**
 * List all certificate filenames in a given directory.
 * Returns an empty array if the directory does not exist.
 * @param {string} dir — Absolute path to the certificate directory
 * @returns {string[]}
 */
function listCertificatesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.der') || f.endsWith('.pem'));
}

/**
 * Move a certificate from rejected/ to trusted/certs/ using atomic fs.renameSync.
 * Validates the filename to prevent path traversal attacks.
 *
 * @param {string} pkiDir   — Root PKI directory
 * @param {string} filename — Name of the certificate file (e.g. "server.der")
 */
function trustCertificateInStore(pkiDir, filename) {
  // Validate: only allow safe filenames — prevent path traversal
  if (!/^[\w-]+\.(der|pem)$/.test(filename)) {
    throw new Error(`Invalid certificate filename: ${filename}`);
  }

  const src  = path.join(pkiDir, 'rejected',       filename);
  const dest = path.join(pkiDir, 'trusted', 'certs', filename);

  if (!fs.existsSync(src)) {
    throw new Error(`Certificate not found in rejected store: ${filename}`);
  }

  // Atomic move — never copy+delete (prevents inconsistent intermediate state)
  fs.renameSync(src, dest);
}

module.exports = {
  PKI_SUBDIRS,
  ensurePkiDirectories,
  ensureSelfSignedCertificate,
  listCertificatesInDir,
  trustCertificateInStore
};

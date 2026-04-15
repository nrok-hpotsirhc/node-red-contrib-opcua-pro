'use strict';
// WP-C-5: pki-manager — Auto-generate X.509 certificates and manage trust store
// See: docs/work-packages.md#wp-c-5-security--pki-ui
// See: docs/theoretical-foundations.md#44-pki-und-x509-zertifikate

const fs   = require('fs');
const path = require('path');

const PKI_SUBDIRS = [
  'own/certs',
  'own/private',
  'trusted/certs',
  'rejected',
  'issuers/certs'
];

function ensurePkiDirectories(pkiDir) {
  for (const subdir of PKI_SUBDIRS) {
    fs.mkdirSync(path.join(pkiDir, subdir), { recursive: true });
  }
}

async function ensureClientCertificate(pkiDir, applicationName) {
  ensurePkiDirectories(pkiDir);

  const certFile = path.join(pkiDir, 'own', 'certs', 'client.der');
  const keyFile  = path.join(pkiDir, 'own', 'private', 'client_key.pem');

  if (!fs.existsSync(certFile)) {
    // TODO WP-C-5: Use node-opcua-certificate createSelfSignedCertificate()
    // await createSelfSignedCertificate({
    //   outputFile:     certFile,
    //   privateKey:     keyFile,
    //   applicationUri: `urn:${os.hostname()}:NodeRED:${applicationName}`,
    //   subject:        `/CN=${applicationName}/O=NodeRED/C=DE`,
    //   validity:       3650
    // });
  }

  return { certFile, keyFile };
}

function listRejectedCertificates(pkiDir) {
  const rejectedDir = path.join(pkiDir, 'rejected');
  if (!fs.existsSync(rejectedDir)) return [];
  return fs.readdirSync(rejectedDir)
    .filter(f => f.endsWith('.der') || f.endsWith('.pem'));
}

function trustCertificate(pkiDir, filename) {
  // Validate: only allow safe filenames — prevent path traversal
  if (!/^[\w\-]+\.(der|pem)$/.test(filename)) {
    throw new Error(`Invalid certificate filename: ${filename}`);
  }

  const src  = path.join(pkiDir, 'rejected',      filename);
  const dest = path.join(pkiDir, 'trusted/certs', filename);

  if (!fs.existsSync(src)) {
    throw new Error(`Certificate not found in rejected store: ${filename}`);
  }

  // Atomic move — never copy+delete
  fs.renameSync(src, dest);
}

module.exports = { ensurePkiDirectories, ensureClientCertificate, listRejectedCertificates, trustCertificate };

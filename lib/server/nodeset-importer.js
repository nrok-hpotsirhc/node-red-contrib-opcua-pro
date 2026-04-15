'use strict';
// WP-S-3: nodeset-importer — NodeSet2.xml companion specification loader
// See: docs/work-packages.md#wp-s-3-nodeset2xml-importer
// See: docs/theoretical-foundations.md#9-companion-specifications-und-nodeset2xml

const fs   = require('fs');
const path = require('path');

async function importNodeSets(addressSpace, xmlFilePaths) {
  if (!Array.isArray(xmlFilePaths) || xmlFilePaths.length === 0) return;

  const { generateAddressSpace } = require('node-opcua-address-space');

  const validPaths = xmlFilePaths.map(rawPath => {
    const normalized = path.resolve(rawPath);

    // Security: prevent path traversal
    if (rawPath.includes('..')) {
      throw new Error(`Path traversal detected in NodeSet path: ${rawPath}`);
    }

    if (!fs.existsSync(normalized)) {
      throw new Error(`NodeSet2 file not found: ${normalized}`);
    }

    if (!normalized.toLowerCase().endsWith('.xml')) {
      throw new Error(`NodeSet2 file must be an XML file: ${normalized}`);
    }

    return normalized;
  });

  try {
    await generateAddressSpace(addressSpace, validPaths);
  } catch (err) {
    // Isolate error: a bad XML must not crash the entire Node-RED process
    throw new Error(`NodeSet2 import failed: ${err.message}`);
  }
}

module.exports = { importNodeSets };

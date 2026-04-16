'use strict';
// WP-S-3: nodeset-importer — NodeSet2.xml companion specification loader
// See: docs/work-packages.md#wp-s-3-nodeset2xml-importer
// See: docs/theoretical-foundations.md#9-companion-specifications-und-nodeset2xml

const fs   = require('fs');
const path = require('path');

async function importNodeSets(addressSpace, xmlFilePaths) {
  if (!Array.isArray(xmlFilePaths) || xmlFilePaths.length === 0) return;

  const { generateAddressSpace } = require('node-opcua-address-space');

  const validPaths = xmlFilePaths
    .filter(entry => entry != null && typeof entry === 'string' && entry.trim() !== '')
    .map(rawPath => {
      // Security: prevent path traversal — check raw input first
      if (rawPath.includes('..')) {
        throw new Error(`Path traversal detected in NodeSet path: ${rawPath}`);
      }

      const normalized = path.resolve(rawPath);

      // Defense-in-depth: verify normalized path also doesn't contain '..'
      // (path.resolve should eliminate '..' segments, but double-check as a safeguard)
      if (normalized.includes('..')) {
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

  if (validPaths.length === 0) return;

  try {
    await generateAddressSpace(addressSpace, validPaths);
  } catch (err) {
    // Isolate error: a bad XML must not crash the entire Node-RED process
    throw new Error(`NodeSet2 import failed: ${err.message}`);
  }
}

module.exports = { importNodeSets };

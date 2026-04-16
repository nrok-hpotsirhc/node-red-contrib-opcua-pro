'use strict';
// Shared HTTP route helpers for PKI management and input validation.
// Eliminates duplication between client and server config PKI routes.

const VALID_CONFIG_ID = /^[a-z0-9.]+$/i;

/**
 * Validate a Node-RED config node ID from HTTP request parameters.
 * @param {string} configId
 * @returns {boolean}
 */
function isValidConfigId(configId) {
  return typeof configId === 'string' && VALID_CONFIG_ID.test(configId);
}

/**
 * Register the three standard PKI HTTP routes (list rejected, list trusted, trust).
 *
 * @param {object} RED — Node-RED runtime
 * @param {object} opts
 * @param {string} opts.basePath — Route prefix (e.g. '/opcua-admin/pki' or '/opcua-admin/server-pki')
 * @param {string} opts.permission — Node-RED permission scope (e.g. 'opcua-client-config')
 * @param {string} opts.pkiDirProp — Property name on the config node holding the pkiDir (default: 'pkiDir')
 * @param {Function} opts.listRejected — Function(pkiDir) → string[]
 * @param {Function} opts.listTrusted — Function(pkiDir) → string[]
 * @param {Function} opts.trust — Function(pkiDir, filename)
 */
function registerPkiRoutes(RED, opts) {
  const {
    basePath,
    permission,
    pkiDirProp = 'pkiDir',
    listRejected,
    listTrusted,
    trust
  } = opts;

  // List rejected certificates
  RED.httpAdmin.get(
    `${basePath}/rejected`,
    RED.auth.needsPermission(`${permission}.write`),
    (req, res) => {
      const { configId } = req.query;
      if (!configId || !isValidConfigId(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode[pkiDirProp]) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        const files = listRejected(configNode[pkiDirProp]);
        res.json(files.map(f => ({ name: f })));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // List trusted certificates
  RED.httpAdmin.get(
    `${basePath}/trusted`,
    RED.auth.needsPermission(`${permission}.read`),
    (req, res) => {
      const { configId } = req.query;
      if (!configId || !isValidConfigId(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode[pkiDirProp]) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        const files = listTrusted(configNode[pkiDirProp]);
        res.json(files.map(f => ({ name: f })));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Trust a rejected certificate
  RED.httpAdmin.post(
    `${basePath}/trust`,
    RED.auth.needsPermission(`${permission}.write`),
    (req, res) => {
      const { configId, filename } = req.body || {};
      if (!configId || !isValidConfigId(configId)) {
        return res.status(400).json({ error: 'Invalid configId' });
      }
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Missing filename' });
      }
      const configNode = RED.nodes.getNode(configId);
      if (!configNode || !configNode[pkiDirProp]) {
        return res.status(404).json({ error: 'Config node not found' });
      }
      try {
        trust(configNode[pkiDirProp], filename);
        res.json({ success: true });
      } catch (err) {
        if (err.message.includes('Invalid certificate filename')) {
          return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );
}

module.exports = { isValidConfigId, registerPkiRoutes };

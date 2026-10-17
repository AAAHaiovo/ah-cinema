'use strict';

const config = require('../lib/config');
const { createRoute } = require('../lib/route');
const { sendJson } = require('../lib/http');

module.exports = createRoute(
  async (req, res) => {
    sendJson(res, 200, {
      ok: config.configured,
      version: config.version,
      apiVersion: config.apiVersion,
      authRequired: config.authRequired,
      proxyReady: config.hasSigningSecret || !config.isProduction,
      missingEnv: config.missingEnv
    });
  },
  { auth: false, requireConfigured: false, methods: ['GET', 'HEAD', 'OPTIONS'] }
);

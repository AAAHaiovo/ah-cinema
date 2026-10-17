'use strict';

const handler = require('../server/handlers/proxy');

module.exports = handler;
module.exports.config = { supportsResponseStreaming: true, maxDuration: 60 };

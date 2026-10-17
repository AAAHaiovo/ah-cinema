'use strict';

const handler = require('../server/handlers/search');

module.exports = handler;
module.exports.config = { supportsResponseStreaming: true, maxDuration: 30 };

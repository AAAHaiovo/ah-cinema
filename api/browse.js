'use strict';

const handler = require('../server/handlers/browse');

module.exports = handler;
module.exports.config = { maxDuration: 30 };

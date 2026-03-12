/**
 * E2E test server bootstrap.
 * Patches Node.js module resolution to handle @/ path aliases from tsconfig.json,
 * then starts the server via ts-node.
 *
 * Usage: node tests/e2e/start-server.cjs
 */
'use strict';
const Module = require('module');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');

const _original = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return _original(path.join(SRC, request.slice(2)), parent, isMain, options);
  }
  return _original(request, parent, isMain, options);
};

// Register ts-node so TypeScript source is compiled on-the-fly
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../../tsconfig.json'),
});

require('../../src/server');

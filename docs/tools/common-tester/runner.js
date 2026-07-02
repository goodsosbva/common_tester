const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  try {
    return resolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && request.startsWith('.') && parent?.filename) {
      const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidate)) return candidate;
    }
    throw error;
  }
};

require('./runner.ts');

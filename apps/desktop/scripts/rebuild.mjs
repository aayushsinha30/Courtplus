import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rebuild } from '@electron/rebuild';

const { values } = parseArgs({ options: { arch: { type: 'string', default: process.arch } } });
const require = createRequire(import.meta.url);
const { version: electronVersion } = require('electron/package.json');
const operation = rebuild({
  buildPath: resolve(import.meta.dirname, '..'),
  projectRootPath: resolve(import.meta.dirname, '../../..'),
  electronVersion,
  arch: values.arch,
  // SQLite and ONNX ship Node-API binaries that load unchanged in Electron.
  ignoreModules: ['better-sqlite3-multiple-ciphers', 'onnxruntime-node'],
});
await operation;
console.log(`Native dependency preparation complete for Electron ${electronVersion} (${values.arch}).`);

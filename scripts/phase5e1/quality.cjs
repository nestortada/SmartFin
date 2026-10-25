/* global __filename */
const fs = require('node:fs');
const path = require('node:path');
const phase = process.argv[2] || 'final';
if (!/^[a-z-]+$/.test(phase)) throw Error('Invalid evidence directory');
const source = fs.readFileSync(path.join(__dirname, '../phase5d/quality.cjs'), 'utf8')
  .replace("path.resolve(__dirname, '../..')", 'process.cwd()')
  .replaceAll('atomicidad-fase5d/quality', 'atomicidad-fase5e1/' + phase)
  .replace("'docs/performance/shared-commands/node-reader-wait.json',",
    "'docs/performance/shared-commands/node-reader-wait.json',\n  'docs/atomicidad-fase5e/node/integration.json',")
  .replace('const restoredHistoricalReports = [];',
    "fs.copyFileSync(path.join(root, 'docs/atomicidad-fase5e/node/integration.json'), path.join(output, 'integration.json'));\nconst restoredHistoricalReports = [];");
const Module = require('node:module');
const runner = new Module(__filename, module);
runner.filename = __filename;
runner.paths = module.paths;
runner._compile(source, __filename);

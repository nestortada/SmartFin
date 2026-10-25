// Preserve the previous phases' generated reports while recording fresh 5E results.
const fs = require('node:fs');
const path = require('node:path');
const phase = process.argv[2] || 'final';
if (!/^[a-z-]+$/.test(phase)) throw Error('Invalid evidence directory');
const source = fs.readFileSync(path.join(__dirname, '../phase5d/quality.cjs'), 'utf8')
  .replace('path.resolve(__dirname, \'../..\')', 'process.cwd()')
  .replaceAll('atomicidad-fase5d/quality', 'atomicidad-fase5e/' + phase);
// Execute the audited quality runner with this phase's output directory only.
const Module = require('node:module');
const runner = new Module(__filename, module);
runner.filename = __filename;
runner.paths = module.paths;
runner._compile(source, __filename);

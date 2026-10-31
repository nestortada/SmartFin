// Phase 6B.2: rewrites the given checkout files from CRLF to LF only when the LF bytes equal the Git
// index blob (same content as committed). Refuses anything else. Usage: node normalize-lf.cjs <files...>
const fs = require('node:fs'), path = require('node:path'), {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
for (const file of process.argv.slice(2)) {
  const absolute = path.join(root, file);
  const lf = fs.readFileSync(absolute, 'latin1').replace(/\r\n/g, '\n');
  const indexed = execFileSync('git', ['show', `:${file}`], {cwd: root, encoding: 'latin1', maxBuffer: 64 * 1024 * 1024});
  if (lf !== indexed) throw Error(`Not identical to the index once LF: ${file}`);
  fs.writeFileSync(absolute, lf, 'latin1');
  console.log(`LF ${file}`);
}

// Phase 6B.2 read-only diagnostic: lists attested non-src files of a prepared workspace whose bytes in
// this checkout differ from the attestation, and whether they match once CRLF is read as LF.
// Usage: node scripts/phase6b2/check-attested.cjs <workspace>
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const record = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'source-fingerprints.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
for (const [file, digest] of Object.entries(record.originalHashes)) {
  if (file.startsWith('src/')) continue;
  const bytes = fs.readFileSync(path.join(root, file));
  if (hash(bytes) === digest) continue;
  const lf = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  console.log(JSON.stringify({file, crlf: bytes.includes('\r\n'), matchesAsLf: hash(lf) === digest}));
}

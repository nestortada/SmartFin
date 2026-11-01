// 6B.3 diagnostic: prints the non-ASCII code points of given lines of a file (read-only).
// Usage: node scripts/phase6b3/char-codes.cjs <file> <line> [line...]
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
for (const number of process.argv.slice(3).map(Number)) {
  const line = lines[number - 1];
  const codes = [...line].map((ch, i) => (ch.charCodeAt(0) > 127 ? `${i}:U+${ch.codePointAt(0).toString(16).padStart(4, '0')}` : null)).filter(Boolean);
  console.log(number, codes.join(' ') || 'ascii only', line.endsWith('\r') ? 'CRLF' : 'LF');
}

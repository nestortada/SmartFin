// 6B.3: freezes the pre-6B.3 card payment use case (commit 8985346) as a test-only oracle.
// Reads the blob from Git, not the working copy, and only rewrites relative import paths.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const SOURCE = 'src/modules/creditCards/useCases/creditCardTransactionRelations.ts';
const TARGET = '__tests__/helpers/pre6B3CreditCardRelations.ts';
const COMMIT = '8985346';

const replacements = [
  ["from '../../../shared/", "from '../../src/shared/"],
  ["from '../../accounts'", "from '../../src/modules/accounts'"],
  ["from '../../accounts/", "from '../../src/modules/accounts/"],
  ["from '../../transactions'", "from '../../src/modules/transactions'"],
  ["from '../../transactions/", "from '../../src/modules/transactions/"],
  ["from '../../../database/", "from '../../src/database/"],
  ["from './creditCardPaymentScope'", "from '../../src/modules/creditCards/useCases/creditCardPaymentScope'"],
  ["from '../repositories/", "from '../../src/modules/creditCards/repositories/"],
  ["from '../repositories'", "from '../../src/modules/creditCards/repositories'"],
  ["from '../types'", "from '../../src/modules/creditCards/types'"],
  ["from './manageCreditCards'", "from '../../src/modules/creditCards/useCases/manageCreditCards'"],
];

let text = execFileSync('git', ['show', `${COMMIT}:${SOURCE}`], { encoding: 'utf8' });
for (const [from, to] of replacements) text = text.split(from).join(to);
const relative = text.match(/from '\.{1,2}\/(?!\.\.\/src\/)[^']*'/g);
if (relative) throw new Error(`Unrewritten imports: ${relative.join(', ')}`);
fs.writeFileSync(TARGET, `// Frozen pre-6B.3 implementation (commit ${COMMIT}), test-only oracle: partial payments keep this contract.\n${text}`);
console.log(`${TARGET} written from ${COMMIT}:${SOURCE}`);

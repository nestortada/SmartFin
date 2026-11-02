// Phase 0 diagnostics: observations of each reproduction, written under docs/linea-base-fase0/node.
// Ordinary runs are redirected to artifacts/ by __tests__/setup/redirectEvidenceWrites.js;
// SMARTFIN_WRITE_EVIDENCE=1 refreshes the versioned copy on purpose.
const fs = require('node:fs') as {
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const process = require('node:process') as { version: string };
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => { prepare: (sql: string) => { get: () => { v: string } }; close: () => void };
};

/** confirmed/discarded are backed by assertions; ambiguous needs a product decision; notExecutable explains why. */
export type Phase0Status = 'confirmed' | 'discarded' | 'ambiguous' | 'notExecutable';
export type Phase0Observation = { status: Phase0Status; observed: unknown; expected?: unknown; note?: string };

function sqliteVersion(): string {
  const database = new DatabaseSync(':memory:');
  try { return database.prepare('SELECT sqlite_version() AS v').get().v; } finally { database.close(); }
}

export function phase0Evidence(name: string): Record<string, Phase0Observation> {
  const results: Record<string, Phase0Observation> = {};
  afterAll(() => {
    fs.mkdirSync('docs/linea-base-fase0/node', { recursive: true });
    fs.writeFileSync(`docs/linea-base-fase0/node/${name}.json`, JSON.stringify({
      runtime: process.version, sqlite: sqliteVersion(), results,
    }, null, 2) + '\n');
  });
  return results;
}

/** Independent oracle: exact cents from the decimal text of an amount, never from production helpers. */
export function cents(amount: number | string): bigint {
  const text = typeof amount === 'number' ? String(amount) : amount;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Not a two-decimal amount: ${text}`);
  const value = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  return match[1] ? -value : value;
}

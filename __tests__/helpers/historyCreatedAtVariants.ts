// Phase 5E.3: created_at shapes applied after the 5E.2 seed. Pure SQL without
// imports so Node and the synthetic Android APK rewrite identical histories.
// 5E.1 fixtures used a constant created_at, which hid defect 5E2-001.
export const CREATED_AT_VARIANTS = [
  'grouped', // increasing with rowid, groups of three tied (5E.2 default)
  'reverse', // decreasing with rowid: index order and rowid order disagree
  'scrambled', // 1009 values permuted over rowid: ties at unrelated positions
  'constant', // single value (5E.1 Android fixtures)
  'mixedFormat', // date-only, millis, seconds and scrambled values compared as text
] as const;
export type CreatedAtVariant = (typeof CREATED_AT_VARIANTS)[number];

const scrambled = "strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-10', '+' || ((rowid * 7919) % 1009) || ' seconds')";
const EXPRESSIONS: Record<CreatedAtVariant, string> = {
  grouped: "strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-10', '+' || (rowid / 3) || ' seconds')",
  reverse: "strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-10', '+' || ((1000000 - rowid) / 3) || ' seconds')",
  scrambled,
  constant: "'2026-10-24'",
  mixedFormat: `CASE rowid % 4 WHEN 0 THEN '2026-10-10' WHEN 1 THEN '2026-10-10T00:00:05.000Z'
    WHEN 2 THEN '2026-10-10T00:00:05Z' ELSE ${scrambled} END`,
};

export function createdAtStatement(variant: CreatedAtVariant): string {
  const expression = EXPRESSIONS[variant];
  return `UPDATE transactions SET created_at = ${expression}, updated_at = ${expression};`;
}

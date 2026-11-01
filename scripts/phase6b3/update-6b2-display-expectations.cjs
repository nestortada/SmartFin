// 6B.3: updates the 6B.2 display expectations for non-zero amounts below $1 (the stored values and
// aggregate paths are unchanged). The file holds literal U+00A0; each replacement must match exactly once.
const fs = require('node:fs');
const FILE = '__tests__/dashboardAggregatesPhase6B2.test.ts';
const N = ' ';
const replacements = [
  [
    `      expect(r.negativeFortyCents.figures.availableBalance).toMatchObject({ next: '-0.4', nextDisplay: '-$${N}0', previousDisplay: '-$${N}0' });\n` +
    `      expect(r.debtFortyCents.figures.totalDebt).toMatchObject({ next: '0.4', nextDisplay: '$${N}0', visibleChange: false });\n` +
    `      expect(r.debtFortyCents.figures.netWorth).toMatchObject({ next: '-0.4', nextDisplay: '-$${N}0' });`,
    `      // 6B.3: both are shown with two decimals (they read -$ 0 / $ 0 with the frozen pre-6B.2 formatter).\n` +
    `      expect(r.negativeFortyCents.figures.availableBalance).toMatchObject({ next: '-0.4', nextDisplay: '-$\\u00a00,40', previousDisplay: '-$\\u00a00' });\n` +
    `      expect(r.debtFortyCents.figures.totalDebt).toMatchObject({ next: '0.4', nextDisplay: '$\\u00a00,40', visibleChange: true });\n` +
    `      expect(r.debtFortyCents.figures.netWorth).toMatchObject({ next: '-0.4', nextDisplay: '-$\\u00a00,40' });`,
  ],
  [
    `      expect(r.historicalResidueZero.figures.availableBalance.nextDisplay).toBe('-$${N}0');`,
    `      // 6B.3: still visible and never shown as zero.\n` +
    `      expect(r.historicalResidueZero.figures.availableBalance.nextDisplay).toBe('> -$\\u00a00,01');`,
  ],
  [
    `      for (const value of values.filter(v => !Object.is(v, -0))) {\n` +
    `        expect(formatCurrency(value, 'COP')).toBe(previousDashboard.formatCurrency(value, 'COP'));\n` +
    `      }\n` +
    `      expect(formatCurrency(-0.4, 'COP')).toBe('-$${N}0');\n` +
    `      expect(formatCurrency(-2.7755575615628914e-17, 'COP')).toBe('-$${N}0');`,
    `      // 6B.3: |x| >= 1 unchanged; non-zero amounts below $1 are no longer shown as $ 0 / -$ 0 / $ 1.\n` +
    `      for (const value of values.filter(v => !Object.is(v, -0) && !(v !== 0 && Math.abs(v) < 1))) {\n` +
    `        expect(formatCurrency(value, 'COP')).toBe(previousDashboard.formatCurrency(value, 'COP'));\n` +
    `      }\n` +
    `      expect(formatCurrency(-0.4, 'COP')).toBe('-$\\u00a00,40');\n` +
    `      expect(formatCurrency(-0.5, 'COP')).toBe('-$\\u00a00,50');\n` +
    `      expect(formatCurrency(-2.7755575615628914e-17, 'COP')).toBe('> -$\\u00a00,01');`,
  ],
];
let text = fs.readFileSync(FILE, 'utf8');
for (const [from, to] of replacements) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one match, found ${count}: ${from.slice(0, 80)}`);
  text = text.replace(from, () => to);
}
text = text.replace("test('only the IEEE negative zero changes: −0 shows $ 0; every non-zero value is formatted as before'",
  () => "test('−0 shows $ 0; every value with |x| >= 1 is formatted as before (below $1: 6B.3 policy)'");
fs.writeFileSync(FILE, text);
console.log('updated', FILE);

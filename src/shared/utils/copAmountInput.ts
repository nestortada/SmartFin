/** Preserve incomplete decimal drafts while grouping COP thousands. */
export function formatCopAmountInput(value: string): string {
  const clean = value.replace(/[^\d,]/g, '');
  const [integer = '', ...decimals] = clean.split(',');
  const grouped = integer
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = value.trim().startsWith('-') ? '-' : '';
  return (
    prefix +
    (decimals.length ? `${grouped},${decimals.join('').slice(0, 2)}` : grouped)
  );
}

export function parseCopAmountDraft(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) &&
    Math.abs(amount) <= Number.MAX_SAFE_INTEGER / 100
    ? amount
    : 0;
}

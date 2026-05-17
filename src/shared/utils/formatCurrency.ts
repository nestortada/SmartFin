export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    currency,
    style: 'currency',
  }).format(value);
}

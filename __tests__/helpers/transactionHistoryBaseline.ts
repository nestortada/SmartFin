import type { Transaction } from '../../src/modules/transactions/types';

// Frozen phase 1/2 hook semantics, captured before phase 3 production edits.
export function baselineHistory(
  transactions: Transaction[],
  month = 'all',
  account = 'all',
  category = 'all',
  search = '',
  sort: 'newest' | 'oldest' = 'newest',
): Transaction[] {
  let result = [...transactions];
  if (month !== 'all') result = result.filter(t => t.date && t.date.startsWith(month));
  if (account !== 'all') result = result.filter(t => t.type === 'internalTransfer'
    ? t.accountId === account
    : t.accountId === account || t.targetAccountId === account);
  if (category !== 'all') result = result.filter(t => t.categoryId === category);
  if (search.trim().length > 0) {
    const query = search.toLowerCase();
    result = result.filter(t => [t.merchantName, t.description, t.notes]
      .some(value => value && value.toLowerCase().includes(query)));
  }
  return result.sort((a, b) => sort === 'newest'
    ? new Date(b.date).getTime() - new Date(a.date).getTime()
    : new Date(a.date).getTime() - new Date(b.date).getTime());
}

import { dashboardFixture, insertSyntheticHistory } from './dashboardFixture';
import { readString } from '../../src/database/sqliteRows';

/** Synthetic volume fixture only; never opens a file or an installed database. */
export async function sharedPositionVolume(size: number) {
  const fixture = await dashboardFixture();
  insertSyntheticHistory(fixture, 100000);
  if (size === 0) return fixture;
  fixture.native.exec('BEGIN');
  for (let person = 0; person < 50; person++)
    fixture.native
      .prepare('INSERT INTO shared_contacts VALUES(?,?,?,?)')
      .run(
        `person-${person}`,
        `Synthetic person ${person}`,
        '2026-01-01',
        '2026-01-01',
      );
  const purchases = fixture.native
    .prepare(
      "SELECT id,date FROM transactions WHERE type='expense' AND status='posted' ORDER BY id LIMIT ?",
    )
    .all(size);
  const receipts = fixture.native
    .prepare(
      "SELECT id,date FROM transactions WHERE type='refund' AND direction='inflow' AND status='posted' ORDER BY id LIMIT ?",
    )
    .all(size);
  if (purchases.length !== size || receipts.length !== size)
    throw new Error('Invalid synthetic fixture size');
  purchases.forEach((purchase, index) => {
    const expense = `expense-${index}`;
    const contact = `person-${index % 50}`;
    const receipt = receipts[index]!;
    const purchaseId = readString(purchase, 'id');
    const receiptId = readString(receipt, 'id');
    const snapshot = JSON.stringify([
      { id: `own-${index}`, amountMinor: 1500000 },
      { id: `part-${index}`, contactId: contact, amountMinor: 1500000 },
    ]);
    fixture.native
      .prepare('UPDATE transactions SET amount=30000 WHERE id=?')
      .run(purchaseId);
    fixture.native
      .prepare('UPDATE transactions SET amount=7500 WHERE id=?')
      .run(receiptId);
    fixture.native
      .prepare('INSERT INTO shared_expenses VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        expense,
        purchaseId,
        3000000,
        readString(purchase, 'date').slice(0, 10),
        'Synthetic shared expense',
        snapshot,
        'active',
        '2026-01-01',
        '2026-01-01',
      );
    for (const [id, person, type] of [
      [`own-${index}`, null, 'shared_personal'],
      [`part-${index}`, contact, 'shared_third_party'],
    ])
      fixture.native
        .prepare(
          "INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at,shared_expense_id,contact_id,amount_minor,shared_active) VALUES(?,?,?,15000,'COP','2026-01-01','2026-01-01',?,?,1500000,1)",
        )
        .run(id!, purchaseId, type!, expense, person!);
    fixture.native
      .prepare('INSERT INTO shared_receipts VALUES(?,?,?,?,?,?,?,?)')
      .run(
        `receipt-${index}`,
        receiptId,
        contact,
        750000,
        readString(receipt, 'date').slice(0, 10),
        'active',
        '2026-01-01',
        '2026-01-01',
      );
    fixture.native
      .prepare('INSERT INTO shared_allocations VALUES(?,?,?,?,?,?,?,?)')
      .run(
        `allocation-${index}`,
        `receipt-${index}`,
        `part-${index}`,
        `part-${index}`,
        750000,
        1,
        '2026-01-01',
        '2026-01-01',
      );
  });
  fixture.native.exec('COMMIT');
  return fixture;
}

/* Synthetic command campaign shared by Jest/Node and the isolated Hermes APK. */
const purchase = {
  accountId: 'bank',
  amount: 30000,
  categoryId: 'food',
  merchantName: 'Synthetic',
  operationType: 'Débito',
  occurrence: { kind: 'date', date: '2026-10-05' },
};
const distribution = {
  mode: 'amounts',
  personalAmount: 15000,
  participants: [{ contactId: 'person', amount: 15000 }],
};
const date = '2026-10-10';
async function campaign(api, measure) {
  const run = (label, command) => measure(label, command);
  const created = await run('createPurchase', () =>
    api.createPurchase('create', { purchase, distribution }),
  );
  const shared = await run('sharePurchase', () =>
    api.sharePurchase('share', {
      transactionId: 'ledger-000000',
      distribution,
    }),
  );
  const part = 'shared:share:split:1';
  await run('updateDistribution', () =>
    api.updateDistribution('distribution', shared.entityId, {
      ...distribution,
      personalAmount: 14000,
      participants: [{ contactId: 'person', amount: 16000 }],
    }),
  );
  await run('updatePurchase', () =>
    api.updatePurchase(
      'edit',
      shared.entityId,
      { ...purchase, amount: 35000 },
      { ...distribution, personalAmount: 20000 },
    ),
  );
  await run('recordReceipt', () =>
    api.recordReceipt('receipt', {
      contactId: 'person',
      accountId: 'target',
      amount: 5000,
      occurrence: { kind: 'date', date },
      applications: [{ participationId: part, amount: 5000 }],
    }),
  );
  await run('linkReceipt', () =>
    api.recordReceipt('link', {
      contactId: 'person',
      transactionId: 'ledger-000001',
      applications: [{ participationId: part, amount: 5000 }],
    }),
  );
  const advance = await run('recordAdvance', () =>
    api.recordReceipt('advance', {
      contactId: 'person',
      accountId: 'target',
      amount: 1000,
      occurrence: { kind: 'date', date },
    }),
  );
  await run('applyReceipt', () =>
    api.applyReceipt('apply', advance.entityId, part, 1000),
  );
  await run('forgivePartial', () =>
    api.forgiveParticipation('partial', {
      participationId: part,
      amount: 1000,
      date,
    }),
  );
  const loss = await run('forgiveFull', () =>
    api.forgiveParticipation('full', {
      participationId: part,
      amount: 3000,
      date,
    }),
  );
  const receipt = await run('recoveryReceipt', () =>
    api.recordReceipt('recovery-receipt', {
      contactId: 'person',
      accountId: 'target',
      amount: 1000,
      occurrence: { kind: 'date', date },
    }),
  );
  const recovered = await run('recoverForgiveness', () =>
    api.recoverForgiveness('recover', {
      forgivenessId: loss.entityId,
      receiptId: receipt.entityId,
      amount: 1000,
      date,
    }),
  );
  await run('reverseRecovery', () =>
    api.reverseLossEvent('undo-recover', { eventId: recovered.entityId, date }),
  );
  await run('reverseForgiveness', () =>
    api.reverseLossEvent('undo-full', { eventId: loss.entityId, date }),
  );
  await run('returnAdvance', () =>
    api.returnAdvance('return', {
      receiptId: receipt.entityId,
      accountId: 'target',
      amount: 500,
      occurrence: { kind: 'date', date },
    }),
  );
  await run('cancelDivision', () =>
    api.cancelDivision('cancel', created.entityId),
  );
  await run('deleteMovement', () =>
    api.deleteMovement('delete', created.transaction.id),
  );
  await run('idempotentReplay', () =>
    api.forgiveParticipation('partial', {
      participationId: part,
      amount: 1000,
      date,
    }),
  );
}
function seedStatements(size, shared) {
  const audit = "'2026-01-01','2026-01-01'";
  const statements = [
    `INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES('bank','Bank','bankAccount','active','COP',1000000,NULL,${audit}),('target','Target','bankAccount','active','COP',0,NULL,${audit}),('card','Card','creditCard','active','COP',0,0,${audit});`,
    "INSERT INTO categories(id,name,type,macro_category,color) VALUES('food','Food','expense','food','#ffffff');",
    `INSERT INTO shared_contacts VALUES('person','Synthetic',${audit});`,
  ];
  for (let i = 0; i < size; i++) {
    const id = `ledger-${String(i).padStart(6, '0')}`;
    const amount =
      i === 0
        ? 30000
        : i === 1
        ? 5000
        : i < shared + 2
        ? 30000
        : i % 3 === 0
        ? 0.1
        : 0.2;
    const income = i === 1;
    // Unique audit sort key: financial reductions have the same order on both engines.
    statements.push(
      `INSERT INTO transactions(id,amount,currency,description,date,account_id,category_id,type,direction,status,payment_method,created_at,updated_at) VALUES('${id}',${amount},'COP','Synthetic','2026-10-05','bank','food','${
        income ? 'income' : 'expense'
      }','${income ? 'inflow' : 'outflow'}','${
        i % 11 === 0 && i > shared + 2 ? 'pending' : 'posted'
      }','debit','${id}','2026-01-01');`,
    );
    if (i >= 2 && i < shared + 2) {
      const e = `expense-${i}`,
        own = `own-${i}`,
        part = `part-${i}`;
      statements.push(
        `INSERT INTO shared_expenses VALUES('${e}','${id}',3000000,'2026-10-05','Synthetic','[{"id":"${own}","amountMinor":1500000},{"id":"${part}","contactId":"person","amountMinor":1500000}]','active',${audit});`,
      );
      statements.push(
        `INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at,shared_expense_id,contact_id,amount_minor,shared_active) VALUES('${own}','${id}','shared_personal',15000,'COP',${audit},'${e}',NULL,1500000,1),('${part}','${id}','shared_third_party',15000,'COP',${audit},'${e}','person',1500000,1);`,
      );
    }
  }
  return statements;
}
module.exports = { campaign, seedStatements };

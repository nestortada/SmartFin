import { openSmartFinDatabase } from './src/database/sqliteDatabase';
import { runSharedSQLiteTransaction } from './src/database/atomicSQLite';
import { captureLocalDatabaseSnapshot } from './src/modules/settings/services/localDatabaseSnapshot';
import { confirmAiCommandReceipt } from './src/modules/transactions/repositories/aiCommandReceipt';

/** Isolated acceptance measurements only; never bundled into the product. */
export async function runAcceptance(campaign, api) {
  const { owned, seed, record, samples, control, backup, config, check } = api;
  const parts = campaign.split('-');
  const condition = parts[1], count = Number(parts[2]), repetition = Number(parts[3] || 0);
  check([1000, 10000, 100000].includes(count), 'Unknown synthetic volume');
  await control.configureSaf();
  if (condition === 'seed') {
    await seed();
    await owned(async (db, permit) => {
      const receipt = await runSharedSQLiteTransaction(db, scope => confirmAiCommandReceipt(scope,
        'acceptance-receipt', { summary: 'Synthetic acceptance', actions: [] }, ['confirmed']), permit);
      check(receipt.status === 'confirmed', 'Synthetic receipt failed');
      await db.executeSql('WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<' + (count - 1) + ") INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) SELECT 't-'||n,1000,'COP','Synthetic','2026-10-18','bank','expense','outflow','posted','2026-10-18','2026-10-18' FROM seq");
    });
    await record('synthetic-fixture-ready-' + count, async () => ({ count, processId: config.processId }));
    return;
  }
  const startup = global.performance.now();
  const database = await openSmartFinDatabase();
  const startupOpenMs = global.performance.now() - startup;
  const [initial] = await database.executeSql('SELECT count(*) AS total FROM transactions');
  check(initial.rows.item(0).total === count, 'Wrong pre-seeded fixture');
  async function measure(index, measured) {
    const job = JSON.parse(await backup.preparePublication());
    const started = global.performance.now();
    const capture = captureLocalDatabaseSnapshot(job.id);
    const reader = openSmartFinDatabase().then(async db => {
      const barrierWaitMs = global.performance.now() - started;
      const [rows] = await db.executeSql('SELECT count(*) AS total FROM transactions');
      return { barrierWaitMs, completionMs: global.performance.now() - started, count: rows.rows.item(0).total };
    });
    const financial = openSmartFinDatabase().then(async db => {
      const barrierWaitMs = global.performance.now() - started;
      // Synthetic contention writer: +1 COP, queued after capture. This is not
      // a benchmark of the payment form or a modification to financial rules.
      const result = await runSharedSQLiteTransaction(db, scope => scope.executeSql("UPDATE accounts SET balance_amount=balance_amount+1 WHERE id='bank'"));
      return { barrierWaitMs, completionMs: global.performance.now() - started, status: result.status };
    });
    const captured = await capture;
    const readerResult = await reader, financialResult = await financial;
    check(readerResult.count === count && financialResult.status === 'confirmed', 'Queued work failed');
    const publicationStart = global.performance.now();
    const published = JSON.parse(await backup.publishSnapshot(job.id, captured.snapshot.id));
    const publicationMs = global.performance.now() - publicationStart;
    const evidence = JSON.parse(await control.csvEvidence(job.id));
    check(evidence.receipts === 1 && evidence.cardRows === 1 && evidence.transactionRows === count, 'Snapshot fixture or CSV mismatch');
    const [live] = await captured.database.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
    check(live.rows.item(0).balance_amount === evidence.balance + 1, 'Publication read from live database');
    const sample = { condition, count, repetition: index, measured, processId: config.processId, startupOpenMs,
      snapshot: captured.snapshot, timings: captured.timings, reader: readerResult, financial: financialResult,
      publicationMs, published, evidence: { balance: evidence.balance, revision: evidence.metadata.revision,
        tables: evidence.metadata.tables, receipts: evidence.receipts, cardRows: evidence.cardRows,
        transactionRows: evidence.transactionRows, csv: evidence.csv } };
    if (measured) samples.push(sample);
    return sample;
  }
  if (condition === 'cold') await record('first-capture-in-new-process-' + count + '-' + repetition, () => measure(repetition, true));
  else {
    check(condition === 'warm', 'Unknown condition');
    await record('unmeasured-warmup-' + count, () => measure(0, false));
    for (let index = 1; index <= 5; index++) await record('warm-capture-' + count + '-' + index, () => measure(index, true));
  }
}

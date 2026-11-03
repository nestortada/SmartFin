'use strict';
// Phase 1a.4A: mechanical, reviewable derivative of the validated 1a.3B probes (r5 hash pinned). Writes a file only.
// Two changes, both because purchases created by the use case now carry their revision 0:
// - integrity preparation: the probes check revision 0 instead of appending one by hand (the repository now rejects a
//   second original revision in the same incarnation);
// - purchaseRecreation: the recreation by the use case opens the new incarnation itself; the trigger rule (after a
//   removal only an original is accepted) is still probed, on a row recreated outside the use case.
// Everything else, every other integrity probe and the migration 5 oracles included, is byte for byte the 1a.3B source.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
if (process.argv.length !== 2) throw Error('No arguments');
const source = 'scripts/phase1a3b/probes.ts';
const bytes = fs.readFileSync(path.join(root, source));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/validacion-fase1a3b/r5/authorization/inputs.sha256.json'), 'utf8'));
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== '6182dd9859a2c9be39157963cf1eec0768feb8298c35c34afc6cdd51264ca35b' || inventory.sources[source] !== digest)
  throw Error('1a.3B probes changed since r5');
const before = `  // Purchases created after the migration have no revision 0 (phase 1a.4); the probes add one with the repository.
  const repository = createSqliteInstallmentHistoryRepository(database);
  for (const [id, count] of [[purchaseId, 3], [secondPurchaseId, 6]] as const)
    await repository.appendPlanRevision({ installmentPurchaseId: id, source: 'original', remainingPrincipalCents: count * 10000000,
      remainingInstallments: count, installmentAmountCents: 10000000, effectiveCycleEnd: null, verification: 'pendingVerification',
      pendingReasons: ['firstCycleUnconfirmed'], basis: { totalAmount: count * 100000, monthlyAmount: 100000, installmentCount: count },
      createdAt: at('2026-10-11') });
`;
const after = `  // 1a.4A: the use case created revision 0 with each purchase (Visa closes on the 20th: projected, first cycle 2026-10-20).
  const repository = createSqliteInstallmentHistoryRepository(database);
  for (const [id, count] of [[purchaseId, 3], [secondPurchaseId, 6]] as const) {
    const plan = await repository.getPlanRevisions(id);
    check(plan.length === 1 && plan[0]!.revisionNumber === 0 && plan[0]!.source === 'original' &&
      plan[0]!.verification === 'projected' && plan[0]!.effectiveCycleEnd === '2026-10-20' &&
      plan[0]!.remainingPrincipalCents === count * 10000000 && plan[0]!.remainingInstallments === count &&
      plan[0]!.installmentAmountCents === 10000000 && plan[0]!.createdAt === at('2026-10-11'), 'Revision 0 created with ' + id);
  }
`;
// purchaseRecreation: the use case now opens the new incarnation itself (revision 2, original). The trigger rule (after a
// removal only an original is accepted) is still probed, on a row recreated outside the use case (revisions 3 and 4).
const recreationBefore = `      await editPurchase(database, exactId, '2026-10-12', 1);
      await editPurchase(database, exactId, '2026-10-12', 4);
      const afterRecreation = selectEffectivePlanRevision(await repository.getPlanRevisions(purchaseId)).status;
      const nonOriginal = await attempt(() => repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'statement',
        remainingPrincipalCents: 1, remainingInstallments: 1, installmentAmountCents: 1, effectiveCycleEnd: '2026-10-20', verification: 'projected',
        pendingReasons: [], createdAt: at('2026-10-15') }));
      const original = await repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'original', remainingPrincipalCents: 30000000,
        remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null, verification: 'pendingVerification',
        pendingReasons: ['firstCycleUnconfirmed'], basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 }, createdAt: at('2026-10-15') });
      const plan = await repository.getPlanRevisions(purchaseId);
      check(afterRecreation === 'removed' && original.revisionNumber === 2, 'New incarnation');
      return { afterRecreation, nonOriginal, original, effective: selectEffectivePlanRevision(plan),
        sources: plan.map(row => row.source) };
`;
const recreationAfter = `      await editPurchase(database, exactId, '2026-10-12', 1);
      await editPurchase(database, exactId, '2026-10-12', 4);
      const recreated = selectEffectivePlanRevision(await repository.getPlanRevisions(purchaseId));
      check(recreated.status === 'current' && recreated.revision.source === 'original' && recreated.revision.revisionNumber === 2 &&
        recreated.revision.remainingInstallments === 4, 'The use case opened the new incarnation');
      const secondOriginal = await attempt(() => repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'original',
        remainingPrincipalCents: 30000000, remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null,
        verification: 'pendingVerification', pendingReasons: ['firstCycleUnconfirmed'],
        basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 }, createdAt: at('2026-10-15') }));
      // Same plan row recreated outside the use case: the removal trigger closes the incarnation, the row has no original.
      await database.executeSql(\`CREATE TEMP TABLE synthetic_kept_plan AS SELECT * FROM installment_purchases WHERE id = ?\`, [purchaseId]);
      await database.executeSql('DELETE FROM installment_purchases WHERE id = ?', [purchaseId]);
      await database.executeSql('INSERT INTO installment_purchases SELECT * FROM synthetic_kept_plan');
      await database.executeSql('DROP TABLE synthetic_kept_plan');
      const afterRecreation = selectEffectivePlanRevision(await repository.getPlanRevisions(purchaseId)).status;
      const nonOriginal = await attempt(() => repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'statement',
        remainingPrincipalCents: 1, remainingInstallments: 1, installmentAmountCents: 1, effectiveCycleEnd: '2026-10-20', verification: 'projected',
        pendingReasons: [], createdAt: at('2026-10-15') }));
      const original = await repository.appendPlanRevision({ installmentPurchaseId: purchaseId, source: 'original', remainingPrincipalCents: 30000000,
        remainingInstallments: 4, installmentAmountCents: 7500000, effectiveCycleEnd: null, verification: 'pendingVerification',
        pendingReasons: ['firstCycleUnconfirmed'], basis: { totalAmount: 300000, monthlyAmount: 75000, installmentCount: 4 }, createdAt: at('2026-10-15') });
      const plan = await repository.getPlanRevisions(purchaseId);
      check(afterRecreation === 'removed' && original.revisionNumber === 4, 'New incarnation');
      return { recreatedByUseCase: recreated.revision, secondOriginal, afterRecreation, nonOriginal, original,
        effective: selectEffectivePlanRevision(plan), sources: plan.map(row => row.source) };
`;
const text = bytes.toString();
if (text.split(before).length !== 2) throw Error('Integrity preparation anchor changed');
if (text.split(recreationBefore).length !== 2) throw Error('purchaseRecreation anchor changed');
const header = `// DERIVED by scripts/phase1a4a/derive-probes.cjs from scripts/phase1a3b/probes.ts (sha256 ${digest}).\n` +
  '// Only the integrity preparation and the purchaseRecreation scenario differ (revision 0 now comes from the use case).\n' +
  '// Do not edit by hand.\n';
const destination = path.join(root, 'scripts/phase1a4a/phase1a3bProbes.ts');
const output = header + text.replace(before, after).replace(recreationBefore, recreationAfter);
if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') !== output) throw Error('Derived file edited by hand; review it');
fs.writeFileSync(destination, output);
console.log(JSON.stringify({ destination: path.relative(root, destination), sourceSha256: digest,
  derivedSha256: crypto.createHash('sha256').update(output).digest('hex') }));

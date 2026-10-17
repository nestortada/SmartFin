// Identical synthetic inputs for Node and Android. No installed user database.
function seedReconciliation(rows, shape = 'mixed') {
  return [
    "UPDATE accounts SET balance_amount=1000000000 WHERE id='bank'",
    `INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,description,created_at,updated_at) VALUES
      ('card2','Mastercard','creditCard','active','COP',0,999,'{"closingDay":31,"paymentDay":5}','2026-01-01','2026-01-01'),
      ('closed-card','Closed','creditCard','closed','COP',0,123,'','2026-01-01','2026-01-01')`,
    `UPDATE accounts SET description='{"closingDay":15,"paymentDay":25}' WHERE id='card'`,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${rows})
      INSERT INTO transactions(id,amount,currency,description,date,civil_date,date_precision,account_id,type,direction,status,target_account_id,created_at,updated_at)
      SELECT 'seed-'||n,
        CASE WHEN n%17=0 THEN 1000000000000.1 WHEN n%5=0 THEN 0.1 WHEN n%3=0 THEN 0.2 ELSE 2500.35 END,
        'COP','Synthetic',
        CASE WHEN n%7=0 THEN '2026-09-30' WHEN n%7=1 THEN '2026-10-01T00:30:00+02:00' WHEN n%7=2 THEN '2026-10-31T23:00:00.000Z' ELSE '2026-10-10T12:00:00.000Z' END,
        CASE WHEN n%8=0 THEN '2026-09-30' ELSE NULL END,
        CASE WHEN n%8=0 THEN 'date' ELSE NULL END,
        ${shape === 'noise' ? "'bank'" : `CASE WHEN n%100=5 THEN 'card2' WHEN n%100=6 THEN 'closed-card' WHEN ${shape === 'dense' ? 'n%2=0' : 'n%100<4'} THEN 'card' WHEN n%100=4 THEN 'bank' ELSE 'bank' END`},
        ${shape === 'noise' ? "'expense'" : "CASE WHEN n%100 IN (4,5) THEN 'creditCardPayment' WHEN n%100=7 THEN 'refund' ELSE 'expense' END"},
        CASE WHEN n%11=0 THEN 'inflow' ELSE 'outflow' END,
        CASE WHEN n%13=0 THEN 'cancelled' WHEN n%3=0 THEN 'pending' ELSE 'posted' END,
        ${shape === 'noise' ? 'NULL' : "CASE WHEN n%100 IN (4,5) THEN 'card' ELSE NULL END"},
        CASE WHEN n%4=0 THEN '2026-10-10T12:00:01.000Z' ELSE '2026-10-10T12:00:00.000Z' END,
        '2026-10-10T12:00:00.000Z'
      FROM seq ORDER BY n DESC`,
    `INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
      VALUES ('base-purchase',250000,'COP','Synthetic','2026-10-11T12:00:00.000Z','card','expense','outflow','posted','2026-10-11','2026-10-11')`,
    `INSERT INTO installment_purchases(id,transaction_id,account_id,total_amount,currency,installment_count,paid_installments,monthly_amount,first_due_date,status,created_at,updated_at)
      VALUES('base-installments','base-purchase','card',250000,'COP',3,1,83333,'2026-11-25','active','2026-10-11','2026-10-11')`,
    `INSERT INTO credit_card_profiles(account_id,monthly_interest_rate,created_at,updated_at) VALUES('card',1.5,'2026-01-01','2026-01-01')`,
    `INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at) VALUES('preserved-split','base-purchase','synthetic',250000,'COP','2026-10-11','2026-10-11')`,
  ];
}
module.exports = { seedReconciliation };

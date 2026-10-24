// Deterministic fixture shared by Node and Android; all IDs are synthetic.
function fixtureSql({ noise = 0, relevant = 0, shape = 'noise', installments = true } = {}) {
  const sql = [
    `INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,credit_limit_amount,description,created_at,updated_at) VALUES
      ('card','Ghost','creditCard','active','COP',0,0,3000000,'smartfin:credit-card:{"closingDay":20,"paymentDay":25}','2026-01-01','2026-01-01'),
      ('card2','Other','creditCard','active','COP',0,0,3000000,NULL,'2026-01-01','2026-01-01'),
      ('account-credit-card-unclassified','Unclassified','bankAccount','active','COP',0,NULL,NULL,NULL,'2026-01-01','2026-01-01')`,
    "INSERT INTO credit_card_profiles(account_id,monthly_interest_rate,created_at,updated_at) VALUES ('card',0.028,'2026-01-01','2026-01-01')",
  ];
  if (noise) sql.push(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${noise})
    INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
    SELECT 'noise-'||n,1,'COP','Synthetic noise','2020-01-01','bank','expense','outflow','posted','2020-01-01','2020-01-01' FROM seq`);
  if (relevant) {
    sql.push(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${relevant})
      INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,payment_method,credit_card_hint,created_at,updated_at)
      SELECT 'purchase-'||n,100+(n%3)*0.25,'COP','Synthetic Ghost',CASE WHEN n%2=0 THEN '2024-01-10' ELSE '2026-10-10' END,
        '${shape === 'paid' ? 'card' : 'account-credit-card-unclassified'}','expense','outflow',
        CASE WHEN n%13=0 THEN 'cancelled' WHEN n%3=0 THEN 'pending' ELSE 'posted' END,'credit','Ghost','2026-01-01','2026-01-01' FROM seq`);
    if (installments) sql.push(`INSERT INTO installment_purchases(id,transaction_id,account_id,total_amount,currency,installment_count,paid_installments,monthly_amount,first_due_date,status,created_at,updated_at)
      SELECT 'installment-'||id,id,account_id,amount,'COP',3,${shape === 'paid' ? '3' : '1'},ROUND(amount/3),'2026-11-25','${shape === 'paid' ? 'paid' : 'active'}','2026-01-01','2026-01-01' FROM transactions WHERE id LIKE 'purchase-%'`);
    sql.push(`INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at)
      SELECT 'split-'||id,id,'synthetic',amount,'COP','2026-01-01','2026-01-01' FROM transactions WHERE id='purchase-1'`);
  }
  if (shape === 'paid') sql.push(`INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,payment_method,target_account_id,created_at,updated_at)
    SELECT 'payment-'||id,amount,'COP','Synthetic payment',date,'bank','creditCardPayment','outflow',status,'debit','card','2026-01-01','2026-01-01' FROM transactions WHERE id LIKE 'purchase-%'`);
  return sql;
}
module.exports = { fixtureSql };

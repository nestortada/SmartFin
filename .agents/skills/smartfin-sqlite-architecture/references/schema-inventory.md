# Inventario SQLite derivado

Generado desde el DDL y el generador de migraciones vigentes con SQLite de Node, en memoria. No se abrió ninguna base real.

39 tablas; 39 índices explícitos; 99 triggers.

El JSON adjunto conserva columnas, restricciones en DDL, FK, acciones de borrado, índices explícitos/automáticos y SQL de cada trigger.

| Tabla | Clave primaria | FK salientes (acción de borrado) |
|---|---|---|
| `account_balance_history` | `id` | `account_id → accounts.id` (CASCADE) |
| `accounts` | `id` | — |
| `ai_command_drafts` | `id` | — |
| `amortization_schedule_items` | `id` | `transaction_id → transactions.id` (NO ACTION); `loan_id → loans.id` (CASCADE) |
| `app_settings` | `setting_key` | — |
| `backup_records` | `id` | — |
| `budgets` | `id` | — |
| `cash_flow_events` | `id` | `account_id → accounts.id` (NO ACTION) |
| `categories` | `id` | — |
| `credit_card_profiles` | `account_id` | `account_id → accounts.id` (CASCADE) |
| `credit_card_statements` | `id` | `account_id → accounts.id` (CASCADE) |
| `envelope_movements` | `id` | `transaction_id → transactions.id` (NO ACTION); `envelope_id → envelopes.id` (CASCADE) |
| `envelopes` | `id` | `category_id → categories.id` (NO ACTION) |
| `financial_data_revision` | `id` | — |
| `financial_goals` | `id` | `linked_account_id → accounts.id` (NO ACTION) |
| `financial_health_scores` | `id` | — |
| `installment_purchases` | `id` | `account_id → accounts.id` (NO ACTION); `transaction_id → transactions.id` (CASCADE) |
| `investment_assets` | `id` | `account_id → accounts.id` (NO ACTION) |
| `loans` | `id` | `account_id → accounts.id` (NO ACTION) |
| `merchant_mappings` | `id` | `account_id → accounts.id` (NO ACTION); `subcategory_id → subcategories.id` (NO ACTION); `category_id → categories.id` (NO ACTION) |
| `raw_financial_messages` | `id` | — |
| `receipt_attachments` | `id` | `transaction_id → transactions.id` (SET NULL) |
| `recurring_subscriptions` | `id` | `account_id → accounts.id` (NO ACTION); `subcategory_id → subcategories.id` (NO ACTION); `category_id → categories.id` (NO ACTION) |
| `schema_migrations` | `version` | — |
| `shared_allocations` | `id` | `participation_id → transaction_splits.id` (SET NULL); `receipt_id → shared_receipts.id` (NO ACTION) |
| `shared_commands` | `id` | — |
| `shared_contacts` | `id` | — |
| `shared_expenses` | `id` | `transaction_id → transactions.id` (NO ACTION) |
| `shared_loss_events` | `id` | `receipt_id → shared_receipts.id` (NO ACTION); `related_event_id → shared_loss_events.id` (NO ACTION); `contact_id → shared_contacts.id` (NO ACTION); `expense_id → shared_expenses.id` (NO ACTION) |
| `shared_receipts` | `id` | `contact_id → shared_contacts.id` (NO ACTION); `transaction_id → transactions.id` (NO ACTION) |
| `shared_returns` | `id` | `transaction_id → transactions.id` (NO ACTION); `receipt_id → shared_receipts.id` (NO ACTION) |
| `smart_alerts` | `id` | — |
| `subcategories` | `id` | `category_id → categories.id` (NO ACTION) |
| `subscription_occurrences` | `id` | `transaction_id → transactions.id` (NO ACTION); `account_id → accounts.id` (NO ACTION); `subscription_id → recurring_subscriptions.id` (CASCADE) |
| `subscription_reminders` | `id` | `occurrence_id → subscription_occurrences.id` (CASCADE) |
| `tax_tags` | `id` | — |
| `transaction_splits` | `id` | `subcategory_id → subcategories.id` (NO ACTION); `category_id → categories.id` (NO ACTION); `transaction_id → transactions.id` (CASCADE); `contact_id → shared_contacts.id` (NO ACTION); `shared_expense_id → shared_expenses.id` (NO ACTION) |
| `transaction_tax_tags` | `transaction_id`, `tax_tag_id` | `tax_tag_id → tax_tags.id` (CASCADE); `transaction_id → transactions.id` (CASCADE) |
| `transactions` | `id` | `source_message_id → raw_financial_messages.id` (NO ACTION); `subcategory_id → subcategories.id` (NO ACTION); `category_id → categories.id` (NO ACTION); `target_account_id → accounts.id` (NO ACTION); `account_id → accounts.id` (NO ACTION) |

## Índices explícitos

- `CREATE INDEX idx_account_balance_history_account_recorded ON account_balance_history(account_id, recorded_at)`
- `CREATE UNIQUE INDEX idx_amortization_loan_installment ON amortization_schedule_items(loan_id, installment_number)`
- `CREATE INDEX idx_budgets_scope ON budgets(scope_type, scope_id)`
- `CREATE INDEX idx_cash_flow_events_expected_date ON cash_flow_events(expected_date)`
- `CREATE INDEX idx_credit_card_profiles_account_id ON credit_card_profiles(account_id)`
- `CREATE INDEX idx_credit_card_statements_account_due ON credit_card_statements(account_id, payment_due_date)`
- `CREATE INDEX idx_envelope_movements_envelope_id ON envelope_movements(envelope_id)`
- `CREATE INDEX idx_financial_goals_status ON financial_goals(status)`
- `CREATE INDEX idx_financial_health_scores_calculated_at ON financial_health_scores(calculated_at)`
- `CREATE INDEX idx_installment_purchases_account_id ON installment_purchases(account_id)`
- `CREATE INDEX idx_investment_assets_account_id ON investment_assets(account_id)`
- `CREATE INDEX idx_loans_account_id ON loans(account_id)`
- `CREATE INDEX idx_merchant_mappings_raw_text ON merchant_mappings(raw_merchant_text)`
- `CREATE INDEX idx_raw_financial_messages_received_at ON raw_financial_messages(received_at)`
- `CREATE INDEX idx_receipt_attachments_transaction_id ON receipt_attachments(transaction_id)`
- `CREATE INDEX idx_recurring_subscriptions_next_charge ON recurring_subscriptions(next_charge_date)`
- `CREATE INDEX idx_shared_allocations_receipt ON shared_allocations(receipt_id, active)`
- `CREATE INDEX idx_shared_allocations_split ON shared_allocations(participation_id, active)`
- `CREATE INDEX idx_shared_loss_date ON shared_loss_events(date, kind)`
- `CREATE INDEX idx_shared_loss_participation ON shared_loss_events(participation_key, kind)`
- `CREATE INDEX idx_shared_loss_receipt ON shared_loss_events(receipt_id, kind)`
- `CREATE INDEX idx_shared_loss_related ON shared_loss_events(related_event_id, kind)`
- `CREATE UNIQUE INDEX idx_shared_loss_reversal ON shared_loss_events(related_event_id) WHERE kind IN ('forgivenessReversal','recoveryReversal')`
- `CREATE INDEX idx_shared_receipts_contact ON shared_receipts(contact_id, status)`
- `CREATE INDEX idx_shared_splits_expense ON transaction_splits(shared_expense_id, shared_active)`
- `CREATE UNIQUE INDEX idx_shared_splits_person ON transaction_splits(shared_expense_id, COALESCE(contact_id,'')) WHERE shared_expense_id IS NOT NULL AND shared_active = 1`
- `CREATE INDEX idx_smart_alerts_status ON smart_alerts(status)`
- `CREATE UNIQUE INDEX idx_subcategories_category_name ON subcategories(category_id, name)`
- `CREATE INDEX idx_subscription_occurrence_status_date ON subscription_occurrences(status, expected_date)`
- `CREATE UNIQUE INDEX idx_subscription_occurrence_transaction ON subscription_occurrences(transaction_id) WHERE transaction_id IS NOT NULL`
- `CREATE INDEX idx_subscription_reminder_delivery ON subscription_reminders(delivery_status, desired)`
- `CREATE INDEX idx_transactions_account_id ON transactions(account_id)`
- `CREATE INDEX idx_transactions_category_id ON transactions(category_id)`
- `CREATE INDEX idx_transactions_civil_day ON transactions(COALESCE(civil_date, substr(date, 1, 10)), status)`
- `CREATE INDEX idx_transactions_civil_sort ON transactions(COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date), created_at DESC)`
- `CREATE INDEX idx_transactions_date ON transactions(date)`
- `CREATE UNIQUE INDEX idx_transactions_dedupe_key ON transactions(dedupe_key) WHERE dedupe_key IS NOT NULL`
- `CREATE INDEX idx_transactions_source_message_id ON transactions(source_message_id)`
- `CREATE INDEX idx_transactions_subcategory_id ON transactions(subcategory_id)`

## Triggers

- `backup_revision_account_balance_history_delete` en `account_balance_history`.
- `backup_revision_account_balance_history_insert` en `account_balance_history`.
- `backup_revision_account_balance_history_update` en `account_balance_history`.
- `backup_revision_accounts_delete` en `accounts`.
- `backup_revision_accounts_insert` en `accounts`.
- `backup_revision_accounts_update` en `accounts`.
- `backup_revision_amortization_schedule_items_delete` en `amortization_schedule_items`.
- `backup_revision_amortization_schedule_items_insert` en `amortization_schedule_items`.
- `backup_revision_amortization_schedule_items_update` en `amortization_schedule_items`.
- `backup_revision_budgets_delete` en `budgets`.
- `backup_revision_budgets_insert` en `budgets`.
- `backup_revision_budgets_update` en `budgets`.
- `backup_revision_cash_flow_events_delete` en `cash_flow_events`.
- `backup_revision_cash_flow_events_insert` en `cash_flow_events`.
- `backup_revision_cash_flow_events_update` en `cash_flow_events`.
- `backup_revision_categories_delete` en `categories`.
- `backup_revision_categories_insert` en `categories`.
- `backup_revision_categories_update` en `categories`.
- `backup_revision_credit_card_profiles_delete` en `credit_card_profiles`.
- `backup_revision_credit_card_profiles_insert` en `credit_card_profiles`.
- `backup_revision_credit_card_profiles_update` en `credit_card_profiles`.
- `backup_revision_credit_card_statements_delete` en `credit_card_statements`.
- `backup_revision_credit_card_statements_insert` en `credit_card_statements`.
- `backup_revision_credit_card_statements_update` en `credit_card_statements`.
- `backup_revision_envelope_movements_delete` en `envelope_movements`.
- `backup_revision_envelope_movements_insert` en `envelope_movements`.
- `backup_revision_envelope_movements_update` en `envelope_movements`.
- `backup_revision_envelopes_delete` en `envelopes`.
- `backup_revision_envelopes_insert` en `envelopes`.
- `backup_revision_envelopes_update` en `envelopes`.
- `backup_revision_financial_goals_delete` en `financial_goals`.
- `backup_revision_financial_goals_insert` en `financial_goals`.
- `backup_revision_financial_goals_update` en `financial_goals`.
- `backup_revision_financial_health_scores_delete` en `financial_health_scores`.
- `backup_revision_financial_health_scores_insert` en `financial_health_scores`.
- `backup_revision_financial_health_scores_update` en `financial_health_scores`.
- `backup_revision_installment_purchases_delete` en `installment_purchases`.
- `backup_revision_installment_purchases_insert` en `installment_purchases`.
- `backup_revision_installment_purchases_update` en `installment_purchases`.
- `backup_revision_investment_assets_delete` en `investment_assets`.
- `backup_revision_investment_assets_insert` en `investment_assets`.
- `backup_revision_investment_assets_update` en `investment_assets`.
- `backup_revision_loans_delete` en `loans`.
- `backup_revision_loans_insert` en `loans`.
- `backup_revision_loans_update` en `loans`.
- `backup_revision_merchant_mappings_delete` en `merchant_mappings`.
- `backup_revision_merchant_mappings_insert` en `merchant_mappings`.
- `backup_revision_merchant_mappings_update` en `merchant_mappings`.
- `backup_revision_receipt_attachments_delete` en `receipt_attachments`.
- `backup_revision_receipt_attachments_insert` en `receipt_attachments`.
- `backup_revision_receipt_attachments_update` en `receipt_attachments`.
- `backup_revision_recurring_subscriptions_delete` en `recurring_subscriptions`.
- `backup_revision_recurring_subscriptions_insert` en `recurring_subscriptions`.
- `backup_revision_recurring_subscriptions_update` en `recurring_subscriptions`.
- `backup_revision_shared_allocations_delete` en `shared_allocations`.
- `backup_revision_shared_allocations_insert` en `shared_allocations`.
- `backup_revision_shared_allocations_update` en `shared_allocations`.
- `backup_revision_shared_commands_delete` en `shared_commands`.
- `backup_revision_shared_commands_insert` en `shared_commands`.
- `backup_revision_shared_commands_update` en `shared_commands`.
- `backup_revision_shared_contacts_delete` en `shared_contacts`.
- `backup_revision_shared_contacts_insert` en `shared_contacts`.
- `backup_revision_shared_contacts_update` en `shared_contacts`.
- `backup_revision_shared_expenses_delete` en `shared_expenses`.
- `backup_revision_shared_expenses_insert` en `shared_expenses`.
- `backup_revision_shared_expenses_update` en `shared_expenses`.
- `backup_revision_shared_loss_events_delete` en `shared_loss_events`.
- `backup_revision_shared_loss_events_insert` en `shared_loss_events`.
- `backup_revision_shared_receipts_delete` en `shared_receipts`.
- `backup_revision_shared_receipts_insert` en `shared_receipts`.
- `backup_revision_shared_receipts_update` en `shared_receipts`.
- `backup_revision_shared_returns_delete` en `shared_returns`.
- `backup_revision_shared_returns_insert` en `shared_returns`.
- `backup_revision_shared_returns_update` en `shared_returns`.
- `backup_revision_smart_alerts_delete` en `smart_alerts`.
- `backup_revision_smart_alerts_insert` en `smart_alerts`.
- `backup_revision_smart_alerts_update` en `smart_alerts`.
- `backup_revision_subcategories_delete` en `subcategories`.
- `backup_revision_subcategories_insert` en `subcategories`.
- `backup_revision_subcategories_update` en `subcategories`.
- `backup_revision_subscription_occurrences_delete` en `subscription_occurrences`.
- `backup_revision_subscription_occurrences_insert` en `subscription_occurrences`.
- `backup_revision_subscription_occurrences_update` en `subscription_occurrences`.
- `backup_revision_subscription_reminders_delete` en `subscription_reminders`.
- `backup_revision_subscription_reminders_insert` en `subscription_reminders`.
- `backup_revision_subscription_reminders_update` en `subscription_reminders`.
- `backup_revision_tax_tags_delete` en `tax_tags`.
- `backup_revision_tax_tags_insert` en `tax_tags`.
- `backup_revision_tax_tags_update` en `tax_tags`.
- `backup_revision_transaction_splits_delete` en `transaction_splits`.
- `backup_revision_transaction_splits_insert` en `transaction_splits`.
- `backup_revision_transaction_splits_update` en `transaction_splits`.
- `backup_revision_transaction_tax_tags_delete` en `transaction_tax_tags`.
- `backup_revision_transaction_tax_tags_insert` en `transaction_tax_tags`.
- `backup_revision_transaction_tax_tags_update` en `transaction_tax_tags`.
- `backup_revision_transactions_delete` en `transactions`.
- `backup_revision_transactions_insert` en `transactions`.
- `backup_revision_transactions_update` en `transactions`.
- `shared_loss_no_update` en `shared_loss_events`.

Detalle completo: [schema-inventory.json](schema-inventory.json). Regenerar tras cambios de esquema; no usar este inventario como sustituto de introspección vigente.

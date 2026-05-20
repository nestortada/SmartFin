import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import {
  closeSmartFinDatabase,
  openSmartFinDatabase,
  type SmartFinSQLiteDatabase,
} from '../database';
import { DashboardScreen } from '../modules/dashboard/ui/DashboardScreen';
import { OnboardingScreen } from '../modules/dashboard/ui/OnboardingScreen';
import { DebitCardsScreen } from '../modules/accounts/ui/DebitCardsScreen';
import {
  TransactionsScreen,
  type TransactionsInitialDraft,
} from '../modules/transactions/ui/TransactionsScreen';
import {
  createSecurityService,
  disableBiometricAccess,
  enableBiometricAccess,
  setLocalAccessSecret,
} from '../modules/security';
import {
  createSmsIngestionService,
  createSqliteFinancialDataRepository,
  createSqliteSettingsRepository,
  deleteFinancialData,
  loadSettings,
  saveRawFinancialSms,
  updateSmsReadingPreference,
  updateTheme,
  parseFinancialSms,
  type SettingsRepository,
  type SettingsState,
  DEFAULT_SETTINGS,
} from '../modules/settings';
import { SettingsScreen } from '../modules/settings/ui/SettingsScreen';
import {
  createSqliteTransactionRepository,
  categorizeMerchantName,
  processSmsAndCreateTransaction,
} from '../modules/transactions';
import { createSqliteAccountRepository, mockAccountRepository } from '../modules/accounts';
import {
  CategoriesScreen,
  createSqliteCategoryRepository,
  mockCategoryRepository,
} from '../modules/categories';
import {
  createSqliteCreditCardAlertRepository,
  findMatchingCreditCardAccount,
  resolveCreditCardTransactionTarget,
  seedCreditCardDemoData,
  shouldTreatTextAsCreditCardTransaction,
} from '../modules/creditCards';
import { CreditCardsScreen } from '../modules/creditCards/ui/CreditCardsScreen';

async function seedDatabaseIfEmpty(database: SmartFinSQLiteDatabase, resetBalancesToZero = false) {
  const accountRepo = createSqliteAccountRepository(database);
  const categoryRepo = createSqliteCategoryRepository(database);
  
  const [accounts, categories] = await Promise.all([
    accountRepo.getAccounts(),
    categoryRepo.getCategories(),
  ]);

  if (categories.length === 0) {
    await categoryRepo.saveCategories(mockCategoryRepository.getCategories());
  }

  if (accounts.length === 0) {
    const defaultAccounts = mockAccountRepository.getAccounts();
    if (resetBalancesToZero) {
      await accountRepo.saveAccounts(
        defaultAccounts.map(a => ({ ...a, balance: { ...a.balance, amount: 0 } }))
      );
    } else {
      await accountRepo.saveAccounts(defaultAccounts);
    }

    if (!resetBalancesToZero) {
      await seedCreditCardDemoData(database);
    }
  }
}

type AppRoute =
  | 'onboarding'
  | 'dashboard'
  | 'transactions'
  | 'settings'
  | 'creditCards'
  | 'debitCards'
  | 'categories';

export function AppNavigator() {
  const [route, setRoute] = useState<AppRoute>('dashboard');
  const [database, setDatabase] = useState<SmartFinSQLiteDatabase>();
  const [settingsRepository, setSettingsRepository] =
    useState<SettingsRepository>();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [busyMessage, setBusyMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [transactionsInitialDraft, setTransactionsInitialDraft] = useState<TransactionsInitialDraft>();
  /**
   * Incrementing this key forces useDashboardSummary to re-fetch from SQLite.
   * We bump it after any operation that mutates financial data:
   *   1. An SMS payment is processed → bump after saving the transaction
   *   2. Financial data is deleted   → bump after the delete completes
   */
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  const securityService = useMemo(() => createSecurityService(), []);
  const smsIngestionService = useMemo(() => createSmsIngestionService(), []);

  // ─── Open database on mount ───────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    openSmartFinDatabase()
      .then(async openedDatabase => {
        if (!isMounted) {
          return;
        }

        const repository = createSqliteSettingsRepository(openedDatabase);
        const persistedSettings = await loadSettings(repository);
        
        await seedDatabaseIfEmpty(openedDatabase);

        setDatabase(openedDatabase);
        setSettingsRepository(repository);
        setSettings(persistedSettings);

        // If SMS reading is NOT activated, go to onboarding!
        if (!persistedSettings.smsReadingEnabled) {
          setRoute('onboarding');
        } else {
          setRoute('dashboard');
        }
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setErrorMessage('No se pudo abrir la base de datos local.');
      });

    return () => {
      isMounted = false;
      void closeSmartFinDatabase();
    };
  }, []);

  // ─── SMS listener ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!database || !settings.smsReadingEnabled) {
      return undefined;
    }

    const transactionRepository = createSqliteTransactionRepository(database);
    const accountRepository = createSqliteAccountRepository(database);

    return smsIngestionService.subscribeToIncomingSms(message => {
      console.log('RECEIVED INCOMING SMS IN REACT NATIVE:', message);
      
      void (async () => {
        // 1. Persist raw SMS
        await saveRawFinancialSms(database, message);

        // 2. Parse + create transaction
        try {
          const parsed = parseFinancialSms(message);
          if (parsed.status !== 'parsed') {
            console.log('SMS could not be parsed as financial:', message.body);
            return;
          }

          // Fetch live accounts from SQLite
          const activeAccounts = await accountRepository.getAccounts();
          const rawCreditText = `${message.title ?? ''} ${message.body} ${parsed.bankName}`;
          const matchedCreditCard = findMatchingCreditCardAccount(
            activeAccounts,
            parsed.bankName,
            rawCreditText,
          );
          const isCreditSms = Boolean(matchedCreditCard) || shouldTreatTextAsCreditCardTransaction(rawCreditText);
          const creditCardTarget = await resolveCreditCardTransactionTarget({
            accountRepository,
            accounts: activeAccounts,
            creditCardHint: parsed.bankName,
            isCreditTransaction: isCreditSms,
            rawText: rawCreditText,
            selectedAccountId: matchedCreditCard?.id,
          });
          let targetAccount = isCreditSms
            ? activeAccounts.find(account => account.id === creditCardTarget.accountId)
            : activeAccounts.find(a =>
                a.name.toUpperCase().includes(parsed.bankName.toUpperCase()) ||
                (a.institutionName && a.institutionName.toUpperCase().includes(parsed.bankName.toUpperCase()))
              );

          // If the account does not exist in the DB, create it dynamically!
          if (!targetAccount && !isCreditSms) {
            const bankId = `account-${parsed.bankName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            // Capitalize the bank name beautifully
            const formattedBankName = parsed.bankName
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');

            const dynamicAccount = {
              id: bankId,
              name: formattedBankName,
              type: 'savingsAccount' as const,
              status: 'active' as const,
              currency: 'COP' as const,
              balance: {
                amount: 1500000,
                currency: 'COP' as const,
              },
              institutionName: formattedBankName,
              description: `Billetera digital ${formattedBankName} creada automáticamente desde SMS.`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await accountRepository.saveAccounts([dynamicAccount]);
            targetAccount = dynamicAccount;
            console.log(`Dynamically created ${formattedBankName} account in database!`);
          }

          // Fallback to savings/bank account, or any account
          if (!targetAccount && !isCreditSms) {
            targetAccount = activeAccounts.find(a => a.type === 'savingsAccount') || activeAccounts[0];
          }

          const accountId = creditCardTarget.accountId ?? targetAccount?.id;
          if (!accountId) {
            console.warn('No active account found for SMS transaction');
            return;
          }

          const categoryId = categorizeMerchantName(parsed.merchantName);
          await processSmsAndCreateTransaction({
            smsMessage: message,
            transactionRepository,
            database,
            accountId,
            categoryId,
            creditCardHint: isCreditSms ? creditCardTarget.creditCardHint ?? parsed.bankName : undefined,
            paymentMethod: isCreditSms ? 'credit' : 'debit',
          });

          if (creditCardTarget.missingCreditCard) {
            await createSqliteCreditCardAlertRepository(database).saveMissingCreditCardAlert({
              creditCardHint: creditCardTarget.creditCardHint ?? parsed.bankName,
            });
            Toast.show({
              type: 'info',
              text1: 'Tarjeta pendiente',
              text2: 'Crea la tarjeta de credito correspondiente para asociar este movimiento.',
            });
          }

          // 3. Tell Dashboard to re-fetch
          setDashboardRefreshKey(k => k + 1);
        } catch (error) {
          console.error('Error processing SMS transaction:', error);
        }
      })();
    });
  }, [database, settings.smsReadingEnabled, smsIngestionService]);

  // ─── Settings helpers ─────────────────────────────────────────────────────

  const persistSettings = useCallback(
    async (nextSettings: SettingsState) => {
      setSettings(nextSettings);

      if (!settingsRepository) {
        return;
      }

      await settingsRepository.saveSettings(nextSettings);
    },
    [settingsRepository],
  );

  const runSettingsTask = useCallback(
    async (message: string, task: () => Promise<void>) => {
      setBusyMessage(message);
      setErrorMessage(undefined);

      try {
        await task();
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo completar la acción.',
        );
      } finally {
        setBusyMessage(undefined);
      }
    },
    [],
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleThemeChange = useCallback(
    async (theme: SettingsState['theme']) => {
      if (!settingsRepository) {
        await persistSettings({ ...settings, theme });
        return;
      }

      const nextSettings = await updateTheme(settingsRepository, settings, theme);
      setSettings(nextSettings);
    },
    [persistSettings, settings, settingsRepository],
  );

  const handleToggleBiometrics = useCallback(
    async (enabled: boolean) => {
      await runSettingsTask(
        enabled ? 'Activando biometría...' : 'Desactivando biometría...',
        async () => {
          if (!settingsRepository) {
            await persistSettings({ ...settings, biometricsEnabled: enabled });
            return;
          }

          const nextSettings = enabled
            ? await enableBiometricAccess(
              settingsRepository,
              securityService,
              settings,
            )
            : await disableBiometricAccess(settingsRepository, settings);

          setSettings(nextSettings);
        },
      );
    },
    [
      persistSettings,
      runSettingsTask,
      securityService,
      settings,
      settingsRepository,
    ],
  );

  const handleSaveCredential = useCallback(
    async (secret: string) => {
      await runSettingsTask('Guardando credencial local...', async () => {
        if (!settingsRepository) {
          await persistSettings({
            ...settings,
            localCredentialEnabled: secret.trim().length >= 4,
          });
          return;
        }

        const nextSettings = await setLocalAccessSecret(
          settingsRepository,
          securityService,
          settings,
          secret,
        );
        setSettings(nextSettings);
      });
    },
    [
      persistSettings,
      runSettingsTask,
      securityService,
      settings,
      settingsRepository,
    ],
  );

  const handleToggleSmsReading = useCallback(
    async (enabled: boolean) => {
      await runSettingsTask(
        enabled ? 'Solicitando permiso SMS...' : 'Desactivando lectura SMS...',
        async () => {
          const permissionState = enabled
            ? await smsIngestionService.requestSmsPermission()
            : Platform.OS === 'android'
              ? 'available'
              : 'unavailable';
          const smsReadingEnabled = enabled && permissionState === 'granted';
          await smsIngestionService.setSmsReadingEnabled(smsReadingEnabled);

          if (!settingsRepository) {
            await persistSettings({
              ...settings,
              smsPermissionState: permissionState,
              smsReadingEnabled,
            });
            return;
          }

          const nextSettings = await updateSmsReadingPreference(
            settingsRepository,
            settings,
            smsReadingEnabled,
            permissionState,
          );
          setSettings(nextSettings);
        },
      );
    },
    [
      persistSettings,
      runSettingsTask,
      settings,
      settingsRepository,
      smsIngestionService,
    ],
  );

  const handleDeleteFinancialData = useCallback(async () => {
    await runSettingsTask('Eliminando datos financieros...', async () => {
      if (!database) {
        throw new Error('La base de datos local aún no está lista.');
      }

      await deleteFinancialData(createSqliteFinancialDataRepository(database));

      // Re-seed essential data (accounts with 0 balance, and categories) 
      // so foreign keys for new SMS transactions don't fail.
      await seedDatabaseIfEmpty(database, true);

      // Refresh dashboard so it reflects the now-empty DB immediately
      setDashboardRefreshKey(k => k + 1);
    });
  }, [database, runSettingsTask]);

  const handleOnboardingStart = useCallback(async () => {
    // 1. Request SMS permission and enable reading
    await handleToggleSmsReading(true);
    // 2. Navigate to dashboard
    setRoute('dashboard');
  }, [handleToggleSmsReading]);

  const handleOnboardingSkip = useCallback(() => {
    setRoute('dashboard');
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (route === 'onboarding') {
    return (
      <OnboardingScreen
        activeTheme={settings.theme}
        onSkip={handleOnboardingSkip}
        onStart={handleOnboardingStart}
      />
    );
  }

  if (route === 'settings') {
    return (
      <SettingsScreen
        busyMessage={busyMessage}
        errorMessage={errorMessage}
        onBack={() => {
          // Go back to onboarding if SMS is disabled, else dashboard
          if (!settings.smsReadingEnabled) {
            setRoute('onboarding');
          } else {
            setRoute('dashboard');
          }
        }}
        onNavigateToHome={() => setRoute('dashboard')}
        onNavigateToTransactions={() => setRoute('transactions')}
        onOpenCategories={() => setRoute('categories')}
        onOpenCreditCards={() => setRoute('creditCards')}
        onOpenDebitCards={() => setRoute('debitCards')}
        onDeleteFinancialData={handleDeleteFinancialData}
        onSaveCredential={handleSaveCredential}
        onThemeChange={handleThemeChange}
        onToggleBiometrics={handleToggleBiometrics}
        onToggleSmsReading={handleToggleSmsReading}
        settings={settings}
      />
    );
  }

  if (route === 'categories') {
    return (
      <CategoriesScreen
        activeTheme={settings.theme}
        database={database}
        onNavigateBack={() => setRoute('settings')}
        onNavigateToHome={() => setRoute('dashboard')}
        onNavigateToTransactions={() => setRoute('transactions')}
        onOpenCreditCards={() => setRoute('creditCards')}
        onOpenDebitCards={() => setRoute('debitCards')}
        onOpenSettings={() => setRoute('settings')}
      />
    );
  }

  if (route === 'transactions') {
    return (
      <TransactionsScreen
        activeTheme={settings.theme}
        database={database}
        initialDraft={transactionsInitialDraft}
        refreshKey={dashboardRefreshKey}
        onNavigateToHome={() => setRoute('dashboard')}
        onOpenSettings={() => setRoute('settings')}
        onOpenCreditCards={() => setRoute('creditCards')}
        onOpenDebitCards={() => setRoute('debitCards')}
        onForceRefresh={() => setDashboardRefreshKey(k => k + 1)}
        onInitialDraftConsumed={() => setTransactionsInitialDraft(undefined)}
      />
    );
  }

  if (route === 'creditCards') {
    return (
      <CreditCardsScreen
        activeTheme={settings.theme}
        database={database}
        refreshKey={dashboardRefreshKey}
        onNavigateToHome={() => setRoute('dashboard')}
        onNavigateToTransactions={() => setRoute('transactions')}
        onOpenDebitCards={() => setRoute('debitCards')}
        onOpenSettings={() => setRoute('settings')}
      />
    );
  }

  if (route === 'debitCards') {
    return (
      <DebitCardsScreen
        activeTheme={settings.theme}
        database={database}
        refreshKey={dashboardRefreshKey}
        onNavigateToHome={() => setRoute('dashboard')}
        onNavigateToTransactions={() => setRoute('transactions')}
        onOpenCreditCards={() => setRoute('creditCards')}
        onOpenSettings={() => setRoute('settings')}
        onOpenTransactionsDraft={draft => {
          setTransactionsInitialDraft(draft);
          setRoute('transactions');
        }}
      />
    );
  }

  return (
    <DashboardScreen
      activeTheme={settings.theme}
      database={database}
      refreshKey={dashboardRefreshKey}
      onOpenCreditCards={() => setRoute('creditCards')}
      onOpenDebitCards={() => setRoute('debitCards')}
      onOpenSettings={() => setRoute('settings')}
      onNavigateToTransactions={() => setRoute('transactions')}
    />
  );
}

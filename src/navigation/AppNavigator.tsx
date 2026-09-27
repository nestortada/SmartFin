import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import {
  closeSmartFinDatabase,
  getFinancialDataRevision,
  openSmartFinDatabase,
  type SmartFinSQLiteDatabase,
} from '../database';
import { DashboardScreen } from '../modules/dashboard/ui/DashboardScreen';
import { DebitCardsScreen } from '../modules/accounts/ui/DebitCardsScreen';
import {
  TransactionsScreen,
  type TransactionsInitialDraft,
} from '../modules/transactions/ui/TransactionsScreen';
import { AiAssistantScreen } from '../modules/transactions/ui/AiAssistantScreen';
import {
  AppAccessGate,
  createSecurityService,
  disableBiometricAccess,
  disableLocalAccessSecret,
  enableBiometricAccess,
  setLocalAccessSecret,
} from '../modules/security';
import {
  createSqliteFinancialDataRepository,
  createSqliteSettingsRepository,
  deleteFinancialData,
  loadSettings,
  updateTheme,
  type SettingsRepository,
  type SettingsState,
  DEFAULT_SETTINGS,
  chooseDriveBackupDirectory,
  exportDriveBackup,
  getDriveBackupStatus,
  type DriveBackupStatus,
} from '../modules/settings';
import { SettingsScreen } from '../modules/settings/ui/SettingsScreen';
import { CategoriesScreen } from '../modules/categories';
import { CreditCardsScreen } from '../modules/creditCards/ui/CreditCardsScreen';

type AppRoute =
  | 'dashboard'
  | 'aiAssistant'
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
  const [accessLocked, setAccessLocked] = useState(false);
  const [backupStatus, setBackupStatus] = useState<DriveBackupStatus>();
  const [transactionsInitialDraft, setTransactionsInitialDraft] = useState<TransactionsInitialDraft>();
  /**
   * Incrementing this key forces useDashboardSummary to re-fetch from SQLite.
   * We bump it after any operation that mutates financial data:
   * Increment after operations that mutate financial data so the dashboard
   * reloads its SQLite-backed summary.
   */
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const lastPromptedBackupRevision = useRef<number | undefined>(undefined);

  const securityService = useMemo(() => createSecurityService(), []);

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
        
        setDatabase(openedDatabase);
        setSettingsRepository(repository);
        setSettings(persistedSettings);
        setAccessLocked(
          persistedSettings.biometricsEnabled ||
            persistedSettings.localCredentialEnabled,
        );

        setRoute('dashboard');
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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (
        nextState === 'active' &&
        (settings.biometricsEnabled || settings.localCredentialEnabled)
      ) {
        setAccessLocked(true);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [settings.biometricsEnabled, settings.localCredentialEnabled]);

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

  const handleToggleLocalCredential = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        return;
      }

      await runSettingsTask('Desactivando PIN de acceso...', async () => {
        if (!settingsRepository) {
          await persistSettings({
            ...settings,
            localCredentialEnabled: false,
          });
          return;
        }

        const nextSettings = await disableLocalAccessSecret(
          settingsRepository,
          securityService,
          settings,
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

  const handleDeleteFinancialData = useCallback(async () => {
    await runSettingsTask('Eliminando datos financieros...', async () => {
      if (!database) {
        throw new Error('La base de datos local aún no está lista.');
      }

      await deleteFinancialData(createSqliteFinancialDataRepository(database));

      // Refresh dashboard so it reflects the now-empty DB immediately
      setDashboardRefreshKey(k => k + 1);
    });
  }, [database, runSettingsTask]);

  const refreshDriveBackupStatus = useCallback(
    async (activeDatabase: SmartFinSQLiteDatabase) => {
      const revision = await getFinancialDataRevision(activeDatabase);
      const status = await getDriveBackupStatus(revision);
      setBackupStatus(status);
      return status;
    },
    [],
  );

  const performDriveBackup = useCallback(async () => {
    if (!database) {
      throw new Error('La base de datos local aún no está lista.');
    }

    await database.executeSql('PRAGMA wal_checkpoint(FULL);');
    const revision = await getFinancialDataRevision(database);
    setDatabase(undefined);
    setSettingsRepository(undefined);

    try {
      await closeSmartFinDatabase();
      const result = await exportDriveBackup(revision);
      setBackupStatus({
        accessNeedsRenewal: false,
        available: true,
        configured: true,
        lastBackupAt: result.lastBackupAt,
        localRevision: revision,
        locationName: result.locationName,
        outdated: false,
        permissionPersistent: result.permissionPersistent,
        remoteRevision: revision,
      });
      lastPromptedBackupRevision.current = revision;
    } finally {
      const reopenedDatabase = await openSmartFinDatabase();
      setDatabase(reopenedDatabase);
      setSettingsRepository(createSqliteSettingsRepository(reopenedDatabase));
    }
  }, [database]);

  const handleExportDriveBackup = useCallback(async () => {
    await runSettingsTask('Actualizando respaldo en Google Drive...', performDriveBackup);
  }, [performDriveBackup, runSettingsTask]);

  const handleChooseDriveBackupDirectory = useCallback(async () => {
    await runSettingsTask('Preparando respaldo en Google Drive...', async () => {
      const selection = await chooseDriveBackupDirectory();
      await performDriveBackup();
      if (!selection.permissionPersistent) {
        Alert.alert(
          'Acceso temporal a la carpeta',
          'El respaldo se creó, pero Google Drive no permitió conservar el acceso permanentemente. Si Android lo solicita después de reiniciar, vuelve a elegir la misma carpeta.',
        );
      }
    });
  }, [performDriveBackup, runSettingsTask]);

  useEffect(() => {
    if (!database) return;

    void refreshDriveBackupStatus(database).catch(() => {
      // Drive can be temporarily unavailable while Android is offline.
    });
  }, [database, dashboardRefreshKey, refreshDriveBackupStatus, route]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && database) {
        void refreshDriveBackupStatus(database).catch(() => {
          // The selected Drive provider can be unavailable while offline.
        });
      }
    });

    return () => subscription.remove();
  }, [database, refreshDriveBackupStatus]);

  useEffect(() => {
    if (
      !backupStatus?.configured ||
      !backupStatus.outdated ||
      accessLocked ||
      lastPromptedBackupRevision.current === backupStatus.localRevision
    ) {
      return;
    }

    lastPromptedBackupRevision.current = backupStatus.localRevision;
    Alert.alert(
      'Respaldo de Google Drive desactualizado',
      'Hay cambios financieros locales que todavía no están en los archivos de Drive.',
      [
        { style: 'cancel', text: 'Después' },
        { onPress: () => { void handleExportDriveBackup(); }, text: 'Actualizar ahora' },
      ],
    );
  }, [accessLocked, backupStatus, handleExportDriveBackup]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (route === 'aiAssistant') {
    return (
      <>
        <AiAssistantScreen
          activeTheme={settings.theme}
          database={database}
          onBack={() => setRoute('dashboard')}
          onCommitted={() => setDashboardRefreshKey(key => key + 1)}
        />
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  if (route === 'settings') {
    return (
      <>
        <SettingsScreen
          backupStatus={backupStatus}
          busyMessage={busyMessage}
          errorMessage={errorMessage}
          onBack={() => setRoute('dashboard')}
          onNavigateToHome={() => setRoute('dashboard')}
          onNavigateToTransactions={() => setRoute('transactions')}
          onOpenCategories={() => setRoute('categories')}
          onOpenCreditCards={() => setRoute('creditCards')}
          onOpenDebitCards={() => setRoute('debitCards')}
          onDeleteFinancialData={handleDeleteFinancialData}
          onChooseDriveBackupDirectory={handleChooseDriveBackupDirectory}
          onExportDriveBackup={handleExportDriveBackup}
          onSaveCredential={handleSaveCredential}
          onThemeChange={handleThemeChange}
          onToggleBiometrics={handleToggleBiometrics}
          onToggleLocalCredential={handleToggleLocalCredential}
          settings={settings}
        />
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  if (route === 'categories') {
    return (
      <>
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
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  if (route === 'transactions') {
    return (
      <>
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
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  if (route === 'creditCards') {
    return (
      <>
        <CreditCardsScreen
          activeTheme={settings.theme}
          database={database}
          refreshKey={dashboardRefreshKey}
          onNavigateToHome={() => setRoute('dashboard')}
          onNavigateToTransactions={() => setRoute('transactions')}
          onOpenDebitCards={() => setRoute('debitCards')}
          onOpenSettings={() => setRoute('settings')}
        />
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  if (route === 'debitCards') {
    return (
      <>
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
        <AppAccessGate
          colorScheme={settings.theme}
          isVisible={accessLocked}
          onUnlocked={() => setAccessLocked(false)}
          securityService={securityService}
          settings={settings}
        />
      </>
    );
  }

  return (
    <>
      <DashboardScreen
        activeTheme={settings.theme}
        database={database}
        refreshKey={dashboardRefreshKey}
        onOpenAiAssistant={() => setRoute('aiAssistant')}
        onOpenCreditCards={() => setRoute('creditCards')}
        onOpenDebitCards={() => setRoute('debitCards')}
        onOpenSettings={() => setRoute('settings')}
        onNavigateToTransactions={() => setRoute('transactions')}
      />
      <AppAccessGate
        colorScheme={settings.theme}
        isVisible={accessLocked}
        onUnlocked={() => setAccessLocked(false)}
        securityService={securityService}
        settings={settings}
      />
    </>
  );
}

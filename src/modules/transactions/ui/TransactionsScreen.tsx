import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  Dimensions,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { AppTheme } from '../../settings';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import { useTransactionsList, formatYearMonth } from '../hooks/useTransactionsList';
import { getNextMonthDueDate, saveManualTransaction } from '../useCases';
import type { Transaction, TransactionType } from '../types';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteCategoryRepository } from '../../categories/repositories/sqliteCategoryRepository';
import {
  createSqliteCreditCardAlertRepository,
  createSqliteCreditCardRepository,
  type MissingCreditCardAlert,
} from '../../creditCards/repositories';
import {
  UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID,
  associatePendingTransactionsForCreditCard,
  reconcileCreditCardTransactions,
  resolveCreditCardTransactionTarget,
  saveCreditCardFromForm,
} from '../../creditCards/useCases';
import { CreditCardFormModal } from '../../creditCards/ui/components/CreditCardFormModal';
import {
  EMPTY_FORM_STATE,
  type CreditCardFormState,
} from '../../creditCards/ui/creditCardUiTypes';
import { toFormInput } from '../../creditCards/ui/creditCardFormatters';
import type { Account } from '../../accounts';
import type { Category } from '../../categories';

import { TransactionCard } from './components/TransactionCard';
import { AddTransactionModal, parseAmountInput } from './components/AddTransactionModal';
import { CategorizationModal } from './components/CategorizationModal';
import {
  MonthPickerModal,
  AccountPickerModal,
  CategoryPickerModal,
  OpTypePickerModal,
  InlineOpTypeModal,
  InstallmentPickerModal,
} from './components/FilterModals';
import {
  formatAmountInputForForm,
  formatCOP,
  formatTransactionDateHeader,
  groupTransactionsByDate,
} from './transactionsScreenFormatters';
import {
  getCreditCardPaletteForTransactions,
  getTransactionsThemeColors,
} from './transactionsTheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TransactionsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  initialDraft?: TransactionsInitialDraft;
  refreshKey?: number;
  onNavigateToHome: () => void;
  onOpenCreditCards: () => void;
  onOpenDebitCards: () => void;
  onOpenSettings: () => void;
  onForceRefresh: () => void;
  onInitialDraftConsumed?: () => void;
};

export type TransactionsInitialDraft = {
  accountId: string;
  action: 'movements' | 'payment' | 'topUp' | 'transferOut';
};

export function TransactionsScreen({
  activeTheme,
  database,
  initialDraft,
  refreshKey = 0,
  onNavigateToHome,
  onOpenCreditCards,
  onOpenDebitCards,
  onOpenSettings,
  onForceRefresh,
  onInitialDraftConsumed,
}: TransactionsScreenProps) {
  const insets = useSafeAreaInsets();
  const isDark = activeTheme === 'dark';

  // State for picker modals
  const [monthModalVisible, setMonthModalVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [addTxModalVisible, setAddTxModalVisible] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [missingCardAlerts, setMissingCardAlerts] = useState<MissingCreditCardAlert[]>([]);

  // Form states for adding manual transaction
  const [newAmount, setNewAmount] = useState('');
  const [newMerchant, setNewMerchant] = useState('');
  const [newType, setNewType] = useState<TransactionType>('expense');
  const [newCategory, setNewCategory] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const [newTargetAccount, setNewTargetAccount] = useState('');
  const [transferTaxCharged, setTransferTaxCharged] = useState(false);
  const [newCreditCardHint, setNewCreditCardHint] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newOperationType, setNewOperationType] = useState<'Débito' | 'Crédito'>('Débito');
  const [creditInstallmentCount, setCreditInstallmentCount] = useState('1');
  const [hasInterestFreeInstallments, setHasInterestFreeInstallments] = useState(false);
  const [interestFreeInstallmentCount, setInterestFreeInstallmentCount] = useState('');
  const [creditCardFormState, setCreditCardFormState] = useState<CreditCardFormState>(EMPTY_FORM_STATE);
  const [creditCardFormVisible, setCreditCardFormVisible] = useState(false);
  const [creditCardFormReturnsToTransaction, setCreditCardFormReturnsToTransaction] = useState(true);
  const [pendingNotificationCardName, setPendingNotificationCardName] = useState<string>();
  const [savingCreditCard, setSavingCreditCard] = useState(false);
  const [opTypePickerVisible, setOpTypePickerVisible] = useState(false);
  const [selectedTxForOpType, setSelectedTxForOpType] = useState<Transaction | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [selectedTxForInstallments, setSelectedTxForInstallments] = useState<Transaction | null>(null);

  // Categorization Modal States
  const [categorizationModalVisible, setCategorizationModalVisible] = useState(false);
  const [selectedTxForCategorization, setSelectedTxForCategorization] = useState<Transaction | null>(null);

  // Fetch live hook data
  const {
    filteredTransactions,
    accounts,
    categories,
    months,
    loading,
    error,
    selectedMonth,
    setSelectedMonth,
    selectedAccount,
    setSelectedAccount,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
  } = useTransactionsList(database, refreshKey);

  const themeColors = getTransactionsThemeColors(activeTheme);
  const creditCardPalette = getCreditCardPaletteForTransactions(activeTheme, themeColors);


  const getCreditCardHintFromTransaction = (tx: Transaction) => {
    const smsBankMatch = tx.notes?.match(/\(([^)]+)\)/);
    return tx.creditCardHint || smsBankMatch?.[1] || tx.merchantName || tx.description;
  };

  const isDebitAccount = (account: Account | undefined) => {
    return Boolean(account && ['cash', 'bankAccount', 'savingsAccount'].includes(account.type));
  };

  const getDebitAccountForTransaction = (tx: Transaction) => {
    const currentAccount = accounts.find(account => account.id === tx.accountId);
    if (isDebitAccount(currentAccount) && currentAccount?.id !== UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID) {
      return currentAccount;
    }

    return accounts.find(
      account =>
        account.status === 'active' &&
        account.id !== UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID &&
        ['cash', 'bankAccount', 'savingsAccount'].includes(account.type),
    );
  };

  const handleUpdateTransactionOpType = async (tx: Transaction, opType: 'Débito' | 'Crédito') => {
    if (!database) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      const accountRepository = createSqliteAccountRepository(database);
      const creditCardRepository = createSqliteCreditCardRepository(database);
      const isCredit = opType.toLowerCase().includes('cr');
      const debitAccount = isCredit ? undefined : getDebitAccountForTransaction(tx);
      if (!isCredit && !debitAccount) {
        Alert.alert('SmartFin', 'Crea una cuenta debito para mover esta transaccion.');
        return;
      }
      const creditCardTarget = await resolveCreditCardTransactionTarget({
        accountRepository,
        accounts,
        creditCardHint: getCreditCardHintFromTransaction(tx),
        isCreditTransaction: isCredit,
        rawText: `${tx.description} ${tx.merchantName ?? ''} ${tx.notes ?? ''}`,
        selectedAccountId: isCredit ? tx.accountId : debitAccount?.id,
      });
      // Clean notes to avoid compounding prefixes
      let cleanNotes = tx.notes || '';
      // Remove any existing "Débito • " or "Crédito • " prefix
      cleanNotes = cleanNotes.replace(/^(Débito|Crédito)\s*•\s*/, '');
      
      const updatedTx: Transaction = {
        ...tx,
        accountId: isCredit ? creditCardTarget.accountId ?? tx.accountId : debitAccount?.id ?? tx.accountId,
        creditCardHint: isCredit ? creditCardTarget.creditCardHint : undefined,
        notes: `${opType} • ${cleanNotes}`,
        paymentMethod: isCredit ? 'credit' : 'debit',
        updatedAt: new Date().toISOString(),
      };
      await txRepo.saveTransactions([updatedTx]);
      if (!isCredit) {
        await txRepo.deleteInstallmentPurchasesByTransactionId(updatedTx.id);
      }
      await reconcileCreditCardTransactions({
        accountRepository,
        creditCardRepository,
        transactionRepository: txRepo,
      });
      if (creditCardTarget.missingCreditCard) {
        await createSqliteCreditCardAlertRepository(database).saveMissingCreditCardAlert({
          creditCardHint: creditCardTarget.creditCardHint,
          transactionId: updatedTx.id,
        });
        await loadMissingCardAlerts();
        Toast.show({
          type: 'info',
          text1: 'Tarjeta pendiente',
          text2: 'Crea la tarjeta de credito correspondiente desde notificaciones.',
        });
      }
      onForceRefresh(); // reload database to reflect updates
    } catch (err) {
      console.error('Error updating transaction operation type:', err);
    }
  };

  const showOpTypeDropdown = (tx: Transaction) => {
    setSelectedTxForOpType(tx);
  };

  const handleSaveInstallmentDetails = async () => {
    if (!database || !selectedTxForInstallments) {
      return;
    }

    const installmentCount = Math.max(1, Number(creditInstallmentCount) || 1);
    const interestFreeCount = hasInterestFreeInstallments
      ? Math.min(Math.max(1, Number(interestFreeInstallmentCount) || installmentCount), installmentCount)
      : 0;
    const now = new Date().toISOString();
    const updatedTx: Transaction = {
      ...selectedTxForInstallments,
      notes: replaceInstallmentDetailsInNotes(selectedTxForInstallments.notes, installmentCount, interestFreeCount),
      updatedAt: now,
    };

    try {
      const txRepo = createSqliteTransactionRepository(database);
      const accountRepository = createSqliteAccountRepository(database);
      const creditCardRepository = createSqliteCreditCardRepository(database);
      await txRepo.saveTransactions([updatedTx]);

      if (installmentCount > 1) {
        await creditCardRepository.saveInstallmentPurchases([
          {
            id: `installment-${updatedTx.id}`,
            transactionId: updatedTx.id,
            accountId: updatedTx.accountId,
            merchantName: updatedTx.merchantName,
            totalAmount: updatedTx.amount,
            currency: updatedTx.currency,
            installmentCount,
            paidInstallments: 0,
            monthlyAmount: Math.round(updatedTx.amount / installmentCount),
            firstDueDate: getNextMonthDueDate(updatedTx.date),
            status: 'active',
            createdAt: updatedTx.createdAt,
            updatedAt: now,
          },
        ]);
      } else {
        await txRepo.deleteInstallmentPurchasesByTransactionId(updatedTx.id);
      }

      await reconcileCreditCardTransactions({
        accountRepository,
        creditCardRepository,
        transactionRepository: txRepo,
      });

      setSelectedTxForInstallments(null);
      resetInstallmentForm();
      onForceRefresh();
    } catch (err) {
      console.error('Error updating installments:', err);
      Alert.alert('Error', 'No se pudieron guardar las cuotas.');
    }
  };

  const handleCardPress = (tx: Transaction) => {
    // Only open categorization modal for purchases / expenses / gastos
    if (tx.direction === 'outflow' || tx.type === 'expense') {
      setSelectedTxForCategorization(tx);
      setCategorizationModalVisible(true);
    }
  };

  const cleanNotesForForm = (notes?: string) => {
    return (notes || '')
      .replace(/^Transferencia\s*(•|â€¢)\s*/, '')
      .replace(/^(Débito|Crédito|DÃ©bito|CrÃ©dito)\s*(•|â€¢)\s*/, '')
      .replace(/\s*\|\s*Cuotas:\s*\d+(\s*\|\s*Sin intereses:\s*\d+)?/i, '')
      .replace(/^Registro manual$/, '');
  };

  const getInstallmentDetailsFromNotes = (notes?: string) => {
    const installmentMatch = notes?.match(/Cuotas:\s*(\d+)/i);
    const interestFreeMatch = notes?.match(/Sin intereses:\s*(\d+)/i);

    return {
      installmentCount: installmentMatch?.[1] ?? '1',
      interestFreeInstallmentCount: interestFreeMatch?.[1] ?? '',
    };
  };

  const replaceInstallmentDetailsInNotes = (
    notes: string | undefined,
    installmentCount: number,
    interestFreeCount: number,
  ) => {
    const baseNotes = (notes || 'Crédito • Registro manual')
      .replace(/\s*\|\s*Cuotas:\s*\d+(\s*\|\s*Sin intereses:\s*\d+)?/i, '')
      .trim();

    if (installmentCount <= 1 && interestFreeCount <= 0) {
      return baseNotes;
    }

    return `${baseNotes} | Cuotas: ${installmentCount}${interestFreeCount > 0 ? ` | Sin intereses: ${interestFreeCount}` : ''}`;
  };

  const resetInstallmentForm = () => {
    setCreditInstallmentCount('1');
    setHasInterestFreeInstallments(false);
    setInterestFreeInstallmentCount('');
  };

  useEffect(() => {
    if (!initialDraft || accounts.length === 0) {
      return;
    }

    const activeDebitAccounts = accounts.filter(
      account =>
        account.status === 'active' &&
        ['bankAccount', 'savingsAccount'].includes(account.type),
    );
    const selectedDebitAccount = activeDebitAccounts.find(account => account.id === initialDraft.accountId);
    const fallbackAccount = activeDebitAccounts.find(account => account.id !== initialDraft.accountId);

    setSelectedAccount(initialDraft.accountId);

    if (initialDraft.action === 'movements') {
      onInitialDraftConsumed?.();
      return;
    }

    setEditingTransaction(null);
    setNewAmount('');
    setNewMerchant(
      initialDraft.action === 'payment'
        ? 'Pago con tarjeta debito'
        : initialDraft.action === 'topUp'
          ? 'Recarga de tarjeta debito'
          : 'Transferencia desde tarjeta debito',
    );
    setNewCategory('');
    setNewCreditCardHint('');
    setNewNotes('');
    setNewOperationType('Débito');
    setTransferTaxCharged(false);
    resetInstallmentForm();

    if (initialDraft.action === 'payment') {
      setNewType('expense');
      setNewAccount(selectedDebitAccount?.id ?? initialDraft.accountId);
      setNewTargetAccount('');
    } else if (initialDraft.action === 'transferOut') {
      setNewType('internalTransfer');
      setNewAccount(selectedDebitAccount?.id ?? initialDraft.accountId);
      setNewTargetAccount(fallbackAccount?.id ?? '');
    } else {
      setNewType('internalTransfer');
      setNewAccount(fallbackAccount?.id ?? '');
      setNewTargetAccount(selectedDebitAccount?.id ?? initialDraft.accountId);
    }

    setAddTxModalVisible(true);
    onInitialDraftConsumed?.();
  }, [accounts, initialDraft, onInitialDraftConsumed, setSelectedAccount]);

  const openInstallmentEditor = (tx: Transaction) => {
    const installmentDetails = getInstallmentDetailsFromNotes(tx.notes);
    setSelectedTxForInstallments(tx);
    setCreditInstallmentCount(installmentDetails.installmentCount);
    setHasInterestFreeInstallments(Boolean(installmentDetails.interestFreeInstallmentCount));
    setInterestFreeInstallmentCount(installmentDetails.interestFreeInstallmentCount);
  };

  const getOperationTypeFromTransaction = (tx: Transaction): 'Débito' | 'Crédito' => {
    const account = accounts.find(candidate => candidate.id === tx.accountId);
    if (tx.paymentMethod === 'credit') {
      return 'Crédito';
    }
    if (account?.type === 'creditCard' || tx.notes?.startsWith('Crédito •')) {
      return 'Crédito';
    }

    return 'Débito';
  };

  const openEditTransactionForm = (tx: Transaction) => {
    const installmentDetails = getInstallmentDetailsFromNotes(tx.notes);
    setEditingTransaction(tx);
    setNewAmount(formatAmountInputForForm(tx.amount));
    setNewMerchant(tx.merchantName || tx.description);
    setNewType(tx.type === 'internalTransfer' ? 'internalTransfer' : tx.type === 'income' || tx.direction === 'inflow' ? 'income' : 'expense');
    setNewCategory(tx.categoryId ?? '');
    setNewAccount(tx.accountId);
    setNewTargetAccount(tx.targetAccountId ?? '');
    setTransferTaxCharged(false);
    setNewCreditCardHint(tx.creditCardHint ?? '');
    setNewNotes(cleanNotesForForm(tx.notes));
    setNewOperationType(getOperationTypeFromTransaction(tx));
    setCreditInstallmentCount(installmentDetails.installmentCount);
    setHasInterestFreeInstallments(Boolean(installmentDetails.interestFreeInstallmentCount));
    setInterestFreeInstallmentCount(installmentDetails.interestFreeInstallmentCount);
    setAddTxModalVisible(true);
  };

  const closeAddTransactionModal = () => {
    setAddTxModalVisible(false);
    setEditingTransaction(null);
  };

  const handleSelectCategory = async (categoryId: string, applyToFuture: boolean) => {
    if (!database || !selectedTxForCategorization) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      const merchantName = selectedTxForCategorization.merchantName || selectedTxForCategorization.description;
      
      if (applyToFuture) {
        // Save the automatic rule in sqlite
        await txRepo.saveMerchantMapping(merchantName, categoryId);
        // Batch update all current transactions matching description/merchantName
        await txRepo.updateTransactionsCategoryByDescription(merchantName, categoryId);
      } else {
        // Update only this single transaction category
        await txRepo.updateTransactionCategory(selectedTxForCategorization.id, categoryId);
      }
      
      onForceRefresh(); // Trigger parent refresh
    } catch (err) {
      console.error('Error selecting category:', err);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!database) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      await txRepo.deleteTransaction(id);
      await reconcileCreditCardTransactions({
        accountRepository: createSqliteAccountRepository(database),
        creditCardRepository: createSqliteCreditCardRepository(database),
        transactionRepository: txRepo,
      });
      onForceRefresh(); // Trigger parent refresh
    } catch (err) {
      console.error('Error deleting transaction:', err);
    }
  };

  const handleCreateCategory = async (
    name: string,
    color: string,
    type: 'income' | 'expense' = 'expense',
  ): Promise<Category | null> => {
    if (!database) return null;
    try {
      const catRepo = createSqliteCategoryRepository(database);
      const newCat = {
        id: 'category-custom-' + Date.now(),
        name,
        type,
        macroCategory: type === 'income' ? 'income' as const : 'other' as const,
        color,
      };
      await catRepo.saveCategories([newCat]);
      onForceRefresh(); // Refresh parent database context
      return newCat;
    } catch (err) {
      console.error('Error creating category:', err);
      return null;
    }
  };

  const handleCreateCategoryFromTransactionModal = async (
    name: string,
    type: 'income' | 'expense',
  ): Promise<Category | null> => {
    return handleCreateCategory(name, type === 'income' ? '#00e475' : '#c5c5d9', type);
  };

  const handleCreateAccount = async (
    name: string,
    type: 'bankAccount' | 'creditCard',
  ): Promise<Account | null> => {
    if (!database) return null;
    try {
      const accountRepository = createSqliteAccountRepository(database);
      const now = new Date().toISOString();
      const newAccountRecord: Account = {
        id: 'account-custom-' + Date.now(),
        name,
        type,
        status: 'active',
        currency: 'COP',
        balance: {
          amount: 0,
          currency: 'COP',
        },
        ...(type === 'creditCard'
          ? {
              creditLimit: {
                amount: 0,
                currency: 'COP' as const,
              },
              debtBalance: {
                amount: 0,
                currency: 'COP' as const,
              },
            }
          : {}),
        institutionName: name,
        createdAt: now,
        updatedAt: now,
      };

      await accountRepository.saveAccounts([newAccountRecord]);
      onForceRefresh();
      return newAccountRecord;
    } catch (err) {
      console.error('Error creating account:', err);
      return null;
    }
  };

  const openCreateCreditCardForm = () => {
    setCreditCardFormState(EMPTY_FORM_STATE);
    setCreditCardFormReturnsToTransaction(true);
    setPendingNotificationCardName(undefined);
    setAddTxModalVisible(false);
    setCreditCardFormVisible(true);
  };

  const closeCreateCreditCardForm = () => {
    if (!savingCreditCard) {
      setCreditCardFormVisible(false);
      setPendingNotificationCardName(undefined);
      if (creditCardFormReturnsToTransaction) {
        setAddTxModalVisible(true);
      }
    }
  };

  const loadMissingCardAlerts = async () => {
    if (!database) {
      return;
    }

    const alerts = await createSqliteCreditCardAlertRepository(database).getPendingMissingCreditCardAlerts();
    setMissingCardAlerts(alerts);
  };

  const openNotifications = async () => {
    await loadMissingCardAlerts();
    setNotificationsVisible(true);
  };

  const openCreditCardFormFromAlert = (alert: MissingCreditCardAlert) => {
    setCreditCardFormState({
      ...EMPTY_FORM_STATE,
      bankName: alert.creditCardName,
      name: alert.creditCardName,
    });
    setCreditCardFormReturnsToTransaction(false);
    setPendingNotificationCardName(alert.creditCardName);
    setNotificationsVisible(false);
    setAddTxModalVisible(false);
    setCreditCardFormVisible(true);
  };

  const handleSaveCreditCardFromTransactionModal = async () => {
    if (!database) {
      Alert.alert('SmartFin', 'La base de datos local no esta disponible.');
      return;
    }

    const input = toFormInput(creditCardFormState);
    if (!input.name) {
      Alert.alert('SmartFin', 'Ingresa el nombre de la tarjeta.');
      return;
    }

    setSavingCreditCard(true);
    try {
      const accountRepository = createSqliteAccountRepository(database);
      const alertRepository = createSqliteCreditCardAlertRepository(database);
      const creditCardRepository = createSqliteCreditCardRepository(database);
      const transactionRepository = createSqliteTransactionRepository(database);
      const savedAccount = await saveCreditCardFromForm(creditCardRepository, input);
      setNewOperationType('Crédito');
      setNewAccount(savedAccount.id);
      setNewCreditCardHint(savedAccount.name);
      const associatedCount = await associatePendingTransactionsForCreditCard({
        account: savedAccount,
        accountRepository,
        creditCardRepository,
        transactionRepository,
      });
      if (associatedCount > 0) {
        await alertRepository.resolveMissingCreditCardAlert(pendingNotificationCardName ?? savedAccount.name);
        Toast.show({
          type: 'success',
          text1: 'Movimientos asociados',
          text2: `${associatedCount} movimiento${associatedCount === 1 ? '' : 's'} pendiente${associatedCount === 1 ? '' : 's'} se vinculó a la tarjeta.`,
        });
      } else if (pendingNotificationCardName) {
        await alertRepository.resolveMissingCreditCardAlert(pendingNotificationCardName);
        Toast.show({
          type: 'success',
          text1: 'Tarjeta creada',
          text2: `${savedAccount.name} se creo con cupo pendiente por completar.`,
        });
      }
      setCreditCardFormVisible(false);
      if (creditCardFormReturnsToTransaction) {
        setAddTxModalVisible(true);
      }
      setPendingNotificationCardName(undefined);
      setCreditCardFormState(EMPTY_FORM_STATE);
      onForceRefresh();
    } catch (saveError) {
      Alert.alert(
        'SmartFin',
        saveError instanceof Error ? saveError.message : 'No se pudo guardar la tarjeta.',
      );
    } finally {
      setSavingCreditCard(false);
    }
  };

  // Sum available balance
  const totalBalance = accounts
    .filter(a => a.status === 'active' && ['cash', 'bankAccount', 'savingsAccount'].includes(a.type))
    .reduce((sum, a) => sum + a.balance.amount, 0);

  // Handle Bottom Nav switching
  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'home') {
      onNavigateToHome();
    } else if (tab === 'more') {
      onOpenSettings();
    }
  };

  // Save manual transaction to SQLite
  const handleSaveTransaction = async () => {
    const isCreditCardExpense = newType !== 'income' && newType !== 'internalTransfer' && newOperationType.toLowerCase().includes('cr');
    if (
      !database ||
      !newAmount ||
      !newMerchant ||
      (!newAccount && !isCreditCardExpense) ||
      (newType === 'internalTransfer' && !newTargetAccount)
    ) {
      Alert.alert('Error', 'Por favor, llena los campos obligatorios.');
      return;
    }

    try {
      const cleanAmount = parseAmountInput(newAmount);
      if (!cleanAmount) {
        Alert.alert('Error', 'Monto inválido.');
        return;
      }

      const transactionRepository = createSqliteTransactionRepository(database);
      const accountRepository = createSqliteAccountRepository(database);
      const creditCardRepository = createSqliteCreditCardRepository(database);

      const { creditCardTarget, transaction } = await saveManualTransaction({
        accountId: newAccount || undefined,
        accountRepository,
        accounts,
        amount: cleanAmount,
        categoryId: newCategory || undefined,
        creditCardHint: newCreditCardHint,
        creditCardRepository,
        editingTransaction,
        hasInterestFreeInstallments,
        installmentCountInput: creditInstallmentCount,
        interestFreeInstallmentCountInput: interestFreeInstallmentCount,
        merchantName: newMerchant,
        notes: newNotes,
        operationType: newOperationType,
        targetAccountId: newType === 'internalTransfer' ? newTargetAccount : undefined,
        transactionRepository,
        transactionType: newType,
        transferTaxCharged,
      });

      if (isCreditCardExpense) {
        if (creditCardTarget.missingCreditCard) {
          await createSqliteCreditCardAlertRepository(database).saveMissingCreditCardAlert({
            creditCardHint: creditCardTarget.creditCardHint,
            transactionId: transaction.id,
          });
          await loadMissingCardAlerts();
          Toast.show({
            type: 'info',
            text1: 'Tarjeta pendiente',
            text2: 'Crea la tarjeta de credito correspondiente para asociar este movimiento.',
          });
        }
      }

      setAddTxModalVisible(false);
      setEditingTransaction(null);
      onForceRefresh(); // Trigger parent database reload!

      // Reset form fields
      setNewAmount('');
      setNewMerchant('');
      setNewCategory('');
      setNewAccount('');
      setNewTargetAccount('');
      setTransferTaxCharged(false);
      setNewCreditCardHint('');
      setNewNotes('');
      resetInstallmentForm();
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Error guardando la transacción.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: themeColors.background }]}>
      {/* Dynamic Background Glowing Circles (Apple Liquid Glass blurs) */}
      {isDark && (
        <View style={styles.glowContainer} pointerEvents="none">
          <View style={styles.purpleGlow} />
          <View style={styles.greenGlow} />
        </View>
      )}

      {/* Header bar */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarContainer, { borderColor: themeColors.glassBorder }]}>
            <Text style={styles.avatarText}>SF</Text>
          </View>
          <Text style={[styles.headerTitle, { color: themeColors.text }]}>SmartFin</Text>
        </View>
        <Pressable
          onPress={openNotifications}
          style={[styles.bellButton, { borderColor: themeColors.glassBorder }]}
          android_ripple={{ color: 'rgba(255,255,255,0.1)' }}>
          <Text style={styles.bellIcon}>🔔</Text>
          {missingCardAlerts.length > 0 ? <View style={styles.bellIndicator} /> : null}
        </Pressable>
      </View>

      {/* Balance and active route summary */}
      <View style={styles.activitySummary}>
        <View>
          <Text style={[styles.activityLabel, { color: themeColors.muted }]}>Actividad Reciente</Text>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Movimientos</Text>
        </View>
        <View style={styles.balanceContainer}>
          <Text style={styles.balanceValue}>{formatCOP(totalBalance)}</Text>
          <Text style={[styles.balanceLabel, { color: themeColors.tertiary }]}>SALDO DISPONIBLE</Text>
        </View>
      </View>

      {/* Filter Horizontal Scroll */}
      <View style={styles.filtersContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersScrollContent}>
          
          {/* Month selector */}
          <Pressable
            onPress={() => setMonthModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>📅</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedMonth === 'all' ? 'Todos los Meses' : formatYearMonth(selectedMonth)}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Account selector */}
          <Pressable
            onPress={() => setAccountModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>🏦</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedAccount === 'all'
                ? 'Todos los Bancos'
                : accounts.find(a => a.id === selectedAccount)?.name || 'Banco'}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Category selector */}
          <Pressable
            onPress={() => setCategoryModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>🏷️</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedCategory === 'all'
                ? 'Todas las Categorías'
                : categories.find(c => c.id === selectedCategory)?.name || 'Categoría'}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Sort order switcher */}
          <Pressable
            onPress={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>⇅</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {sortOrder === 'newest' ? 'Recientes Primero' : 'Antiguos Primero'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Frosted Glass Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="Buscar por comercio, notas..."
            placeholderTextColor={themeColors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchInput, { color: themeColors.text }]}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Text style={[styles.clearIcon, { color: themeColors.muted }]}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <Text style={[styles.statusText, { color: themeColors.muted }]}>Cargando movimientos...</Text>
      ) : null}
      {error ? (
        <Text style={[styles.statusText, { color: themeColors.danger }]}>{error}</Text>
      ) : null}
      {/* Main Transactions List grouped by dates */}
      <FlatList
        data={groupTransactionsByDate(filteredTransactions)}
        keyExtractor={item => item.date}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No se encontraron movimientos</Text>
            <Text style={[styles.emptySubtitle, { color: themeColors.muted }]}>
              Intenta quitando algunos filtros o realiza un registro manual.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.dateGroup}>
            <Text style={[styles.dateHeader, { color: themeColors.muted }]}>
              {formatTransactionDateHeader(item.date)}
            </Text>

            {item.data.map(tx => (
              <TransactionCard
                key={tx.id}
                tx={tx}
                isDark={isDark}
                themeColors={themeColors}
                categories={categories}
                accounts={accounts}
                onEditInstallments={openInstallmentEditor}
                onShowOpTypeDropdown={showOpTypeDropdown}
                onPress={handleCardPress}
              />
            ))}
          </View>
        )}
      />

      {/* Floating Action Button (FAB) */}
      <Pressable
        onPress={() => {
          setEditingTransaction(null);
          setNewAmount('');
          setNewMerchant('');
          setNewCategory('');
          setNewAccount('');
          setNewTargetAccount('');
          setTransferTaxCharged(false);
          setNewCreditCardHint('');
          setNewNotes('');
          setNewType('expense');
          setNewOperationType('Débito');
          resetInstallmentForm();
          // prefill default category/account if available
          if (categories.length > 0 && categories[0]) setNewCategory(categories[0].id);
          const defaultDebitAccount = accounts.find(
            account =>
              account.status === 'active' &&
              ['cash', 'bankAccount', 'savingsAccount'].includes(account.type),
          );
          if (defaultDebitAccount) setNewAccount(defaultDebitAccount.id);
          setAddTxModalVisible(true);
        }}
        style={[styles.fabButton, { backgroundColor: themeColors.primary }]}>
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {/* MODALs: Filtering and manual creation */}
      <MonthPickerModal
        visible={monthModalVisible}
        onClose={() => setMonthModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        months={months}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
        formatYearMonth={formatYearMonth}
      />

      <AccountPickerModal
        visible={accountModalVisible}
        onClose={() => setAccountModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        accounts={accounts}
        selectedAccount={selectedAccount}
        onSelectAccount={setSelectedAccount}
      />

      <CategoryPickerModal
        visible={categoryModalVisible}
        onClose={() => setCategoryModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      <AddTransactionModal
        visible={addTxModalVisible}
        onClose={closeAddTransactionModal}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        accounts={accounts}
        newAmount={newAmount}
        setNewAmount={setNewAmount}
        newMerchant={newMerchant}
        setNewMerchant={setNewMerchant}
        newType={newType}
        setNewType={setNewType}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        newAccount={newAccount}
        setNewAccount={setNewAccount}
        newTargetAccount={newTargetAccount}
        setNewTargetAccount={setNewTargetAccount}
        transferTaxCharged={transferTaxCharged}
        setTransferTaxCharged={setTransferTaxCharged}
        newCreditCardHint={newCreditCardHint}
        setNewCreditCardHint={setNewCreditCardHint}
        newNotes={newNotes}
        setNewNotes={setNewNotes}
        newOperationType={newOperationType}
        setNewOperationType={setNewOperationType}
        creditInstallmentCount={creditInstallmentCount}
        setCreditInstallmentCount={setCreditInstallmentCount}
        hasInterestFreeInstallments={hasInterestFreeInstallments}
        setHasInterestFreeInstallments={setHasInterestFreeInstallments}
        interestFreeInstallmentCount={interestFreeInstallmentCount}
        setInterestFreeInstallmentCount={setInterestFreeInstallmentCount}
        opTypePickerVisible={opTypePickerVisible}
        setOpTypePickerVisible={setOpTypePickerVisible}
        onCreateCategory={handleCreateCategoryFromTransactionModal}
        onCreateAccount={handleCreateAccount}
        onCreateCreditCard={openCreateCreditCardForm}
        mode={editingTransaction ? 'edit' : 'create'}
        onSave={handleSaveTransaction}
      />

      <CreditCardFormModal
        form={creditCardFormState}
        mode="create"
        onChange={setCreditCardFormState}
        onClose={closeCreateCreditCardForm}
        onDelete={() => undefined}
        onSave={handleSaveCreditCardFromTransactionModal}
        palette={creditCardPalette}
        saving={savingCreditCard}
        visible={creditCardFormVisible}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setNotificationsVisible(false)}
        transparent
        visible={notificationsVisible}>
        <Pressable style={styles.notificationOverlay} onPress={() => setNotificationsVisible(false)}>
          <Pressable
            onPress={event => event.stopPropagation()}
            style={[styles.notificationSheet, { backgroundColor: themeColors.background, borderColor: themeColors.border }]}>
            <View style={styles.notificationHeader}>
              <Text style={[styles.notificationTitle, { color: themeColors.text }]}>Notificaciones</Text>
              <Pressable onPress={() => setNotificationsVisible(false)} style={[styles.notificationClose, { borderColor: themeColors.border }]}>
                <Text style={[styles.notificationCloseText, { color: themeColors.muted }]}>x</Text>
              </Pressable>
            </View>
            {missingCardAlerts.length === 0 ? (
              <Text style={[styles.notificationEmpty, { color: themeColors.muted }]}>
                No hay tarjetas pendientes por crear.
              </Text>
            ) : (
              missingCardAlerts.map(alert => (
                <Pressable
                  key={alert.id}
                  disabled={savingCreditCard}
                  onPress={() => openCreditCardFormFromAlert(alert)}
                  style={[styles.notificationCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
                  <View style={styles.notificationIcon}>
                    <Text style={[styles.notificationIconText, { color: themeColors.primary }]}>TC</Text>
                  </View>
                  <View style={styles.notificationTextBlock}>
                    <Text style={[styles.notificationCardTitle, { color: themeColors.text }]}>
                      {alert.creditCardName}
                    </Text>
                    <Text style={[styles.notificationCardBody, { color: themeColors.muted }]}>
                      Toca para abrir el formulario de tarjeta con estos datos.
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <OpTypePickerModal
        visible={opTypePickerVisible}
        onClose={() => setOpTypePickerVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        newOperationType={newOperationType}
        onSelectOpType={setNewOperationType}
      />

      <InlineOpTypeModal
        tx={selectedTxForOpType}
        onClose={() => setSelectedTxForOpType(null)}
        isDark={isDark}
        themeColors={themeColors}
        onSelectOpType={handleUpdateTransactionOpType}
      />

      <InstallmentPickerModal
        tx={selectedTxForInstallments}
        onClose={() => {
          setSelectedTxForInstallments(null);
          resetInstallmentForm();
        }}
        isDark={isDark}
        themeColors={themeColors}
        installmentCount={creditInstallmentCount}
        onChangeInstallmentCount={setCreditInstallmentCount}
        hasInterestFreeInstallments={hasInterestFreeInstallments}
        onChangeHasInterestFreeInstallments={setHasInterestFreeInstallments}
        interestFreeInstallmentCount={interestFreeInstallmentCount}
        onChangeInterestFreeInstallmentCount={setInterestFreeInstallmentCount}
        onSave={handleSaveInstallmentDetails}
      />

      <CategorizationModal
        visible={categorizationModalVisible}
        onClose={() => setCategorizationModalVisible(false)}
        tx={selectedTxForCategorization}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        onSelectCategory={handleSelectCategory}
        onDeleteTransaction={handleDeleteTransaction}
        onCreateCategory={handleCreateCategory}
        onEditTransaction={openEditTransactionForm}
      />

      {/* Shared Bottom Tab Navigation bar */}
      <BottomNavigation
        activeTab="transactions"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else if (action === 'debitCards') {
            onOpenDebitCards();
          } else {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  accText: {
    fontSize: 12,
    fontWeight: '500',
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  activitySummary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatarContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: {
    color: '#bbc3ff',
    fontSize: 13,
    fontWeight: '800',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  balanceValue: {
    color: '#00e475',
    fontSize: 20,
    fontWeight: '800',
  },
  bellButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  bellIcon: {
    fontSize: 16,
  },
  bellIndicator: {
    backgroundColor: '#00e475',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 9,
    top: 9,
    width: 8,
  },
  notificationCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  notificationCardBody: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 2,
  },
  notificationCardTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  notificationClose: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  notificationCloseText: {
    fontSize: 14,
    fontWeight: '900',
  },
  notificationEmpty: {
    fontSize: 14,
    fontWeight: '800',
    paddingVertical: 18,
    textAlign: 'center',
  },
  notificationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  notificationIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(187, 195, 255, 0.12)',
    borderRadius: 20,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  notificationIconText: {
    fontSize: 12,
    fontWeight: '900',
  },
  notificationOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 4, 8, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  notificationSheet: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    maxWidth: 520,
    padding: 18,
    width: '100%',
  },
  notificationTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  notificationTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  catBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  catBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  catEmoji: {
    fontSize: 16,
  },
  catIconContainer: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  chevronDown: {
    fontSize: 11,
    marginLeft: 3,
  },
  clearIcon: {
    fontSize: 14,
    padding: 6,
  },
  dateGroup: {
    gap: 12,
    marginBottom: 20,
  },
  dateHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  fabButton: {
    alignItems: 'center',
    borderRadius: 28,
    bottom: 104,
    elevation: 8,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: 22,
    shadowColor: '#000',
    shadowOffset: {
      height: 4,
      width: 0,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    width: 56,
    zIndex: 99,
  },
  fabIcon: {
    color: '#001d93',
    fontSize: 28,
    fontWeight: '600',
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 36,
    paddingHorizontal: 12,
  },
  filterChipIcon: {
    fontSize: 13,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filtersContainer: {
    height: 46,
    paddingHorizontal: 14,
  },
  filtersScrollContent: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 24,
  },
  formContainer: {
    gap: 16,
    paddingBottom: 32,
  },
  formHorizonList: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  formInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    height: 48,
    paddingHorizontal: 14,
  },
  formInputLarge: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    height: 80,
    paddingHorizontal: 14,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  formDropdownTrigger: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  formToggle: {
    flexDirection: 'row',
    gap: 10,
  },
  glassModal: {
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '60%',
    padding: 20,
    width: SCREEN_WIDTH * 0.85,
  },
  glassModalLarge: {
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: '90%',
    padding: 22,
    width: SCREEN_WIDTH * 0.9,
  },
  glowContainer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  greenGlow: {
    backgroundColor: 'rgba(0, 228, 117, 0.10)',
    borderRadius: 180,
    height: 360,
    position: 'absolute',
    right: -100,
    top: 250,
    width: 360,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  horizonChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  horizonChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    gap: 18,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  purpleGlow: {
    backgroundColor: 'rgba(205, 189, 255, 0.12)',
    borderRadius: 200,
    height: 400,
    left: -120,
    position: 'absolute',
    top: -50,
    width: 400,
  },
  screen: {
    flex: 1,
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: 12,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    height: '100%',
    padding: 0,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingVertical: 4,
    textAlign: 'center',
  },
});

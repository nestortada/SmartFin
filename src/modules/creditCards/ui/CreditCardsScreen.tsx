import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import { formatCurrency } from '../../../shared/utils/formatCurrency';
import type { Account } from '../../accounts';
import type { AppTheme } from '../../settings';
import { useCreditCardsOverview } from '../hooks';
import {
  createSqliteCreditCardAlertRepository,
  createSqliteCreditCardRepository,
} from '../repositories';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { CreditCardSummary } from '../types';
import {
  associatePendingTransactionsForCreditCard,
  deleteCreditCard,
  reconcileCreditCardTransactions,
  registerCreditCardPayment,
  saveCreditCardFromForm,
} from '../useCases';
import { CreditCardFormModal } from './components/CreditCardFormModal';
import { CreditCardCarousel } from './components/CreditCardCarousel';
import {
  CreditCardDatesCard,
  CreditCardLimitCard,
  InstallmentsSection,
  MinimumPaymentCard,
  StatementTransactionsSection,
} from './components/CreditCardInsightCards';
import {
  CreditCardPaymentAction,
  CreditCardPaymentModal,
} from './components/CreditCardPayment';
import {
  CreditCardsEmptyState,
  CreditCardsErrorState,
  CreditCardsHeader,
  CreditCardsLoadingState,
} from './components/CreditCardsScreenStates';
import {
  EMPTY_FORM_STATE,
  type CreditCardFormMode,
  type CreditCardFormState,
} from './creditCardUiTypes';
import { creditCardsPalettes } from './creditCardsPalette';
import {
  formatCreditLimitInput,
  formStateFromCard,
  parseMoneyInput,
  toFormInput,
} from './creditCardFormatters';

type CreditCardsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenDebitCards: () => void;
  onOpenSettings: () => void;
  refreshKey?: number;
};

export function CreditCardsScreen({
  activeTheme,
  database,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenDebitCards,
  onOpenSettings,
  refreshKey = 0,
}: CreditCardsScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = creditCardsPalettes[activeTheme];
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const { error, loading, overview } = useCreditCardsOverview(database, refreshKey + localRefreshKey);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [formMode, setFormMode] = useState<CreditCardFormMode>('create');
  const [formCardId, setFormCardId] = useState<string>();
  const [formState, setFormState] = useState<CreditCardFormState>(EMPTY_FORM_STATE);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [paymentAccounts, setPaymentAccounts] = useState<Account[]>([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState<string>();
  const [payingCard, setPayingCard] = useState(false);
  const [savingCard, setSavingCard] = useState(false);

  useEffect(() => {
    if (overview.cards.length === 0) {
      setSelectedCardId(undefined);
      return;
    }

    if (!selectedCardId || !overview.cards.some(card => card.account.id === selectedCardId)) {
      setSelectedCardId(overview.cards[0]?.account.id);
    }
  }, [overview.cards, selectedCardId]);

  const selectedCard = useMemo(
    () => overview.cards.find(card => card.account.id === selectedCardId) ?? overview.cards[0],
    [overview.cards, selectedCardId],
  );

  const refreshCards = () => setLocalRefreshKey(current => current + 1);

  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'home') {
      onNavigateToHome();
    } else if (tab === 'transactions') {
      onNavigateToTransactions();
    }
  };

  const openCreateForm = () => {
    setFormMode('create');
    setFormCardId(undefined);
    setFormState(EMPTY_FORM_STATE);
    setIsFormVisible(true);
  };

  const openEditForm = (card: CreditCardSummary) => {
    setSelectedCardId(card.account.id);
    setFormMode('edit');
    setFormCardId(card.account.id);
    setFormState(formStateFromCard(card));
    setIsFormVisible(true);
  };

  const handleCardPress = (card: CreditCardSummary) => {
    if (card.account.id !== selectedCard?.account.id) {
      setSelectedCardId(card.account.id);
      return;
    }

    openEditForm(card);
  };

  const closeForm = () => {
    if (!savingCard) {
      setIsFormVisible(false);
    }
  };

  const handleSaveCard = async () => {
    if (!database) {
      Alert.alert('SmartFin', 'La base de datos local no esta disponible.');
      return;
    }

    const input = toFormInput(formState, formCardId);
    if (!input.name) {
      Alert.alert('SmartFin', 'Ingresa el nombre de la tarjeta.');
      return;
    }

    setSavingCard(true);
    try {
      const repository = createSqliteCreditCardRepository(database);
      const existingCard = overview.cards.find(card => card.account.id === formCardId);
      const savedAccount = await saveCreditCardFromForm(repository, input, existingCard?.account);
      const associatedCount = await associatePendingTransactionsForCreditCard({
        account: savedAccount,
        accountRepository: createSqliteAccountRepository(database),
        creditCardRepository: repository,
        transactionRepository: createSqliteTransactionRepository(database),
      });
      if (associatedCount > 0) {
        await createSqliteCreditCardAlertRepository(database).resolveMissingCreditCardAlert(savedAccount.name);
        Toast.show({
          type: 'success',
          text1: 'Movimientos asociados',
          text2: `${associatedCount} movimiento${associatedCount === 1 ? '' : 's'} pendiente${associatedCount === 1 ? '' : 's'} se vinculó a la tarjeta.`,
        });
      }
      setSelectedCardId(savedAccount.id);
      refreshCards();
      setIsFormVisible(false);
    } catch (saveError) {
      Alert.alert(
        'SmartFin',
        saveError instanceof Error ? saveError.message : 'No se pudo guardar la tarjeta.',
      );
    } finally {
      setSavingCard(false);
    }
  };

  const handleDeleteCard = () => {
    if (!database || !formCardId) {
      return;
    }

    Alert.alert('Eliminar tarjeta', 'La tarjeta se ocultara de tus tarjetas activas.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setSavingCard(true);
          try {
            const accountRepository = createSqliteAccountRepository(database);
            const creditCardRepository = createSqliteCreditCardRepository(database);
            const transactionRepository = createSqliteTransactionRepository(database);

            await reconcileCreditCardTransactions({
              accountRepository,
              creditCardRepository,
              transactionRepository,
            });
            await deleteCreditCard(creditCardRepository, formCardId);
            setSelectedCardId(undefined);
            refreshCards();
            setIsFormVisible(false);
          } catch (deleteError) {
            Alert.alert(
              'SmartFin',
              deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la tarjeta.',
            );
          } finally {
            setSavingCard(false);
          }
        },
      },
    ]);
  };

  const openPaymentModal = async () => {
    if (!database || !selectedCard) {
      return;
    }

    if (selectedCard.usedCredit <= 0) {
      Alert.alert('SmartFin', 'Esta tarjeta no tiene saldo pendiente por pagar.');
      return;
    }

    try {
      const accountRepository = createSqliteAccountRepository(database);
      const accounts = await accountRepository.getAccounts();
      const sourceAccounts = accounts.filter(
        account =>
          account.status === 'active' &&
          ['cash', 'bankAccount', 'savingsAccount'].includes(account.type),
      );

      if (sourceAccounts.length === 0) {
        Alert.alert('SmartFin', 'Crea una cuenta debito o de ahorro para registrar el pago.');
        return;
      }

      setPaymentAccounts(sourceAccounts);
      setPaymentSourceAccountId(current =>
        current && sourceAccounts.some(account => account.id === current)
          ? current
          : sourceAccounts[0]?.id,
      );
      setPaymentAmount(formatCreditLimitInput(String(Math.round(selectedCard.usedCredit))));
      setPaymentModalVisible(true);
    } catch (loadError) {
      Alert.alert(
        'SmartFin',
        loadError instanceof Error ? loadError.message : 'No se pudieron cargar las cuentas origen.',
      );
    }
  };

  const closePaymentModal = () => {
    if (!payingCard) {
      setPaymentModalVisible(false);
    }
  };

  const handleRegisterPayment = async () => {
    if (!database || !selectedCard) {
      return;
    }

    const amount = parseMoneyInput(paymentAmount);
    if (!paymentSourceAccountId || amount <= 0) {
      Alert.alert('SmartFin', 'Selecciona una cuenta origen e ingresa un monto valido.');
      return;
    }

    setPayingCard(true);
    try {
      const result = await registerCreditCardPayment({
        accountId: selectedCard.account.id,
        accountRepository: createSqliteAccountRepository(database),
        amount,
        creditCardRepository: createSqliteCreditCardRepository(database),
        sourceAccountId: paymentSourceAccountId,
        transactionRepository: createSqliteTransactionRepository(database),
      });

      Toast.show({
        type: 'success',
        text1: 'Pago registrado',
        text2: `Se restauro ${formatCurrency(result.paidAmount, selectedCard.account.currency)} de cupo disponible.`,
      });
      setPaymentModalVisible(false);
      refreshCards();
    } catch (paymentError) {
      Alert.alert(
        'SmartFin',
        paymentError instanceof Error ? paymentError.message : 'No se pudo registrar el pago.',
      );
    } finally {
      setPayingCard(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 140, paddingTop: insets.top + 18 },
        ]}
        style={styles.scrollView}>
        <CreditCardsHeader palette={palette} />
        <CreditCardsLoadingState loading={loading} palette={palette} />
        <CreditCardsErrorState error={error} palette={palette} />
        <CreditCardsEmptyState loading={loading} palette={palette} selectedCard={selectedCard} />

        {overview.cards.length > 0 ? (
          <CreditCardCarousel
            cards={overview.cards}
            onAddCard={openCreateForm}
            onCardPress={handleCardPress}
            palette={palette}
            selectedCardId={selectedCard?.account.id}
          />
        ) : null}

        {selectedCard ? (
          <>
            <CreditCardLimitCard card={selectedCard} palette={palette} />
            <CreditCardPaymentAction
              card={selectedCard}
              onPress={openPaymentModal}
              palette={palette}
              saving={payingCard}
            />
            <CreditCardDatesCard card={selectedCard} palette={palette} />
            <MinimumPaymentCard card={selectedCard} palette={palette} />
            <InstallmentsSection card={selectedCard} palette={palette} />
            <StatementTransactionsSection card={selectedCard} palette={palette} />
          </>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={openCreateForm}
        style={[
          styles.fab,
          {
            backgroundColor: palette.primary,
            shadowColor: palette.primary,
            shadowOpacity: 0.4,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          },
        ]}>
        <Text style={[styles.fabIcon, { color: palette.inverseText }]}>+</Text>
      </Pressable>

      <CreditCardFormModal
        form={formState}
        mode={formMode}
        onChange={setFormState}
        onClose={closeForm}
        onDelete={handleDeleteCard}
        onSave={handleSaveCard}
        palette={palette}
        saving={savingCard}
        visible={isFormVisible}
      />

      <CreditCardPaymentModal
        accounts={paymentAccounts}
        amount={paymentAmount}
        card={selectedCard}
        onAmountChange={value => setPaymentAmount(formatCreditLimitInput(value))}
        onClose={closePaymentModal}
        onSave={handleRegisterPayment}
        onSelectAccount={setPaymentSourceAccountId}
        palette={palette}
        saving={payingCard}
        selectedAccountId={paymentSourceAccountId}
        visible={paymentModalVisible}
      />

      <BottomNavigation
        activeTab="more"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'debitCards') {
            onOpenDebitCards();
          } else if (action === 'settings') {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    gap: 24,
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  fab: {
    alignItems: 'center',
    borderRadius: 28,
    bottom: 96,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: 20,
    width: 56,
    zIndex: 40,
  },
  fabIcon: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 28,
    textAlign: 'center',
  },
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
});

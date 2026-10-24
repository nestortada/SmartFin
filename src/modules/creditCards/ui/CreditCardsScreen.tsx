import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { SQLiteCommandFailure } from '../../../database/atomicSQLite';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import { formatCopAmountInput, parseCopAmountDraft } from '../../../shared/utils/copAmountInput';
import { formatCurrency } from '../../../shared/utils/formatCurrency';
import type { Account } from '../../accounts';
import type { AppTheme } from '../../settings';
import { useCreditCardsOverview } from '../hooks';
import {
  createSqliteCreditCardRepository,
} from '../repositories';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import type { CreditCardSummary } from '../types';
import {
  closeCreditCardWithReconciliation,
  registerCreditCardPayment,
  saveCreditCardWithAssociations,
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
  toFormInput,
} from './creditCardFormatters';

type CreditCardsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenDebitCards: () => void;
  onOpenSettings: () => void;
  onOpenSubscriptions?: () => void;
  refreshKey?: number;
};

export function CreditCardsScreen({
  activeTheme,
  database,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenDebitCards,
  onOpenSettings,
  onOpenSubscriptions,
  refreshKey = 0,
}: CreditCardsScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = creditCardsPalettes[activeTheme];
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const { error, loading, overview } = useCreditCardsOverview(database, refreshKey + localRefreshKey);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [formMode, setFormMode] = useState<CreditCardFormMode>('create');
  const [formCardId, setFormCardId] = useState<string>();
  const formAccount = useRef<Account | undefined>(undefined);
  const formMonthlyRate = useRef<number | undefined>(undefined);
  const [formState, setFormState] = useState<CreditCardFormState>(EMPTY_FORM_STATE);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [paymentAccounts, setPaymentAccounts] = useState<Account[]>([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState<string>();
  const [payingCard, setPayingCard] = useState(false);
  const paymentSubmission = useRef<'idle' | 'running' | 'confirmed' | 'unknown'>('idle');
  const [savingCard, setSavingCard] = useState(false);
  const cardSubmission = useRef<'idle' | 'running' | 'confirmed' | 'unknown'>('idle');

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
    if (cardSubmission.current === 'confirmed') cardSubmission.current = 'idle';
    setFormMode('create');
    setFormCardId(undefined);
    formAccount.current = undefined;
    formMonthlyRate.current = undefined;
    setFormState(EMPTY_FORM_STATE);
    setIsFormVisible(true);
  };

  const openEditForm = (card: CreditCardSummary) => {
    if (cardSubmission.current === 'confirmed') cardSubmission.current = 'idle';
    setSelectedCardId(card.account.id);
    setFormMode('edit');
    setFormCardId(card.account.id);
    formAccount.current = card.account;
    formMonthlyRate.current = card.minimumPaymentSimulation.monthlyInterestRate;
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
    if (cardSubmission.current === 'running' || cardSubmission.current === 'confirmed') return;
    if (cardSubmission.current === 'unknown') {
      Alert.alert('SmartFin', 'El resultado es desconocido. Verifica la tarjeta antes de repetir la operación.');
      return;
    }
    if (!database) {
      Alert.alert('SmartFin', 'La base de datos local no esta disponible.');
      return;
    }

    const input = toFormInput(formState, formCardId);
    if (!input.name) {
      Alert.alert('SmartFin', 'Ingresa el nombre de la tarjeta.');
      return;
    }

    cardSubmission.current = 'running';
    setSavingCard(true);
    let confirmed = false;
    try {
      const repository = createSqliteCreditCardRepository(database);
      const { account: savedAccount, associatedCount } = await saveCreditCardWithAssociations({
        repository, input, existingAccount: formAccount.current, expectedMonthlyInterestRate: formMonthlyRate.current,
      });
      confirmed = true;
      cardSubmission.current = 'confirmed';
      setSelectedCardId(savedAccount.id);
      refreshCards();
      setIsFormVisible(false);
      if (associatedCount > 0) {
        Toast.show({
          type: 'success',
          text1: 'Movimientos asociados',
          text2: `${associatedCount} movimiento${associatedCount === 1 ? '' : 's'} pendiente${associatedCount === 1 ? '' : 's'} se vinculó a la tarjeta.`,
        });
      }
    } catch (saveError) {
      if (!confirmed) cardSubmission.current = saveError instanceof SQLiteCommandFailure ? 'unknown' : 'idle';
      Alert.alert(
        'SmartFin',
        confirmed ? 'La tarjeta quedó guardada. No se pudo mostrar su confirmación.'
          : saveError instanceof Error ? saveError.message : 'No se pudo guardar la tarjeta.',
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
          if (cardSubmission.current === 'running' || cardSubmission.current === 'confirmed') return;
          if (cardSubmission.current === 'unknown') {
            Alert.alert('SmartFin', 'El resultado es desconocido. Verifica la tarjeta antes de repetir la operación.');
            return;
          }
          cardSubmission.current = 'running';
          let confirmed = false;
          setSavingCard(true);
          try {
            await closeCreditCardWithReconciliation({
              repository: createSqliteCreditCardRepository(database), accountId: formCardId,
              expectedAccount: formAccount.current,
            });
            confirmed = true;
            cardSubmission.current = 'confirmed';
            setSelectedCardId(undefined);
            refreshCards();
            setIsFormVisible(false);
          } catch (deleteError) {
            if (!confirmed) cardSubmission.current = deleteError instanceof SQLiteCommandFailure ? 'unknown' : 'idle';
            Alert.alert(
              'SmartFin',
              confirmed ? 'La tarjeta quedó cerrada. Actualiza la vista.'
                : deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la tarjeta.',
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
      if (paymentSubmission.current === 'confirmed') paymentSubmission.current = 'idle';
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
    if (paymentSubmission.current === 'running' || paymentSubmission.current === 'confirmed') return;
    if (paymentSubmission.current === 'unknown') {
      Alert.alert('SmartFin', 'El resultado del pago es desconocido. Verifica su estado antes de registrar otro pago.');
      return;
    }
    if (!database || !selectedCard) {
      return;
    }

    const amount = parseCopAmountDraft(paymentAmount);
    if (!paymentSourceAccountId || amount <= 0) {
      Alert.alert('SmartFin', 'Selecciona una cuenta origen e ingresa un monto valido.');
      return;
    }

    paymentSubmission.current = 'running';
    setPayingCard(true);
    let confirmed = false;
    try {
      const result = await registerCreditCardPayment({
        accountId: selectedCard.account.id,
        accountRepository: createSqliteAccountRepository(database),
        amount,
        creditCardRepository: createSqliteCreditCardRepository(database),
        sourceAccountId: paymentSourceAccountId,
        transactionRepository: createSqliteTransactionRepository(database),
      });

      confirmed = true;
      paymentSubmission.current = 'confirmed';
      setPaymentModalVisible(false);
      refreshCards();
      Toast.show({
        type: 'success',
        text1: 'Pago registrado',
        text2: `Se restauro ${formatCurrency(result.paidAmount, selectedCard.account.currency)} de cupo disponible.`,
      });
    } catch (paymentError) {
      const unknown = paymentError instanceof SQLiteCommandFailure && paymentError.result.status === 'unknown';
      if (!confirmed) paymentSubmission.current = unknown ? 'unknown' : 'idle';
      Alert.alert(
        'SmartFin',
        confirmed ? 'El pago quedó guardado. No se pudo mostrar su confirmación.'
          : paymentError instanceof Error ? paymentError.message : 'No se pudo registrar el pago.',
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
        onAmountChange={value => setPaymentAmount(formatCopAmountInput(value))}
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
          if (action === 'subscriptions') { onOpenSubscriptions?.(); return; }
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

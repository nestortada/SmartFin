import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import type { AppTheme } from '../../settings';
import type { TransactionsInitialDraft } from '../../transactions/ui/TransactionsScreen';
import { useDebitCardsOverview } from '../hooks';
import { createSqliteAccountRepository } from '../repositories';
import {
  deleteDebitCard,
  parseDebitCardMetadata,
  saveDebitCardFromForm,
  type DebitCardFormInput,
} from '../useCases';
import {
  DebitCardManageActions,
  DebitCardQuickActions,
} from './components/DebitCardActions';
import { DebitCardFormModal } from './components/DebitCardFormModal';
import {
  MonthlyAnalysis,
  MovementList,
  RecurringIncomeCard,
  WeeklyTrend,
} from './components/DebitCardInsights';
import { DebitCardPreview } from './components/DebitCardPreview';
import {
  DebitCardsEmptyState,
  DebitCardsErrorState,
  DebitCardsHeader,
  DebitCardsLoadingState,
} from './components/DebitCardsScreenStates';
import { debitCardsPalettes } from './debitCardsPalette';
import { debitCardsStyles as styles } from './debitCardsStyles';

type DebitCardsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenCreditCards: () => void;
  onOpenSettings: () => void;
  onOpenTransactionsDraft: (draft: TransactionsInitialDraft) => void;
  refreshKey?: number;
};

const EMPTY_FORM_INPUT: DebitCardFormInput = {
  currentBalance: 0,
  name: '',
  recurringIncome: {
    amount: 0,
    frequency: 'none',
    incomeType: 'salary',
  },
};

export function DebitCardsScreen({
  activeTheme,
  database,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenCreditCards,
  onOpenSettings,
  onOpenTransactionsDraft,
  refreshKey = 0,
}: DebitCardsScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = debitCardsPalettes[activeTheme];
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const { error, loading, overview } = useDebitCardsOverview(database, refreshKey + localRefreshKey);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [formVisible, setFormVisible] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formInput, setFormInput] = useState<DebitCardFormInput>(EMPTY_FORM_INPUT);

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

  const openDraft = (action: TransactionsInitialDraft['action']) => {
    if (!selectedCard) {
      return;
    }

    onOpenTransactionsDraft({
      accountId: selectedCard.account.id,
      action,
    });
  };

  const openCreateForm = () => {
    setFormInput(EMPTY_FORM_INPUT);
    setFormVisible(true);
  };

  const openEditForm = () => {
    if (!selectedCard) {
      return;
    }

    const metadata = parseDebitCardMetadata(selectedCard.account);
    setFormInput({
      accountId: selectedCard.account.id,
      bankName: selectedCard.account.institutionName ?? metadata.bankName,
      currentBalance: selectedCard.account.balance.amount,
      name: selectedCard.account.name,
      recurringIncome: metadata.recurringIncome ?? EMPTY_FORM_INPUT.recurringIncome,
    });
    setFormVisible(true);
  };

  const handleSaveDebitCard = async () => {
    if (!database) {
      Alert.alert('SmartFin', 'La base de datos local no esta disponible.');
      return;
    }

    setFormSaving(true);
    try {
      const savedAccount = await saveDebitCardFromForm(
        createSqliteAccountRepository(database),
        formInput,
      );
      setSelectedCardId(savedAccount.id);
      setFormVisible(false);
      refreshCards();
    } catch (saveError) {
      Alert.alert(
        'SmartFin',
        saveError instanceof Error ? saveError.message : 'No se pudo guardar la tarjeta debito.',
      );
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteDebitCard = () => {
    if (!database || !selectedCard) {
      return;
    }

    Alert.alert(
      'Eliminar tarjeta debito',
      'La tarjeta se ocultara de tus tarjetas activas. Sus movimientos historicos se conservan.',
      [
        { style: 'cancel', text: 'Cancelar' },
        {
          onPress: async () => {
            try {
              await deleteDebitCard(
                createSqliteAccountRepository(database),
                selectedCard.account.id,
              );
              setSelectedCardId(undefined);
              refreshCards();
            } catch (deleteError) {
              Alert.alert(
                'SmartFin',
                deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la tarjeta debito.',
              );
            }
          },
          style: 'destructive',
          text: 'Eliminar',
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 132, paddingTop: insets.top + 18 },
        ]}
        style={styles.scrollView}>
        <DebitCardsHeader
          onOpenSettings={onOpenSettings}
          palette={palette}
          totalAvailable={overview.totalAvailable}
        />

        {loading ? <DebitCardsLoadingState palette={palette} /> : null}
        {error ? <DebitCardsErrorState error={error} palette={palette} /> : null}

        {overview.cards.length > 0 ? (
          <FlatList
            data={overview.cards}
            horizontal
            keyExtractor={card => card.account.id}
            renderItem={({ item }) => (
              <DebitCardPreview
                card={item}
                onPress={() => setSelectedCardId(item.account.id)}
                palette={palette}
                selected={item.account.id === selectedCard?.account.id}
              />
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardRail}
          />
        ) : (
          <DebitCardsEmptyState palette={palette} />
        )}

        {selectedCard ? (
          <>
            <DebitCardQuickActions
              onMovements={() => openDraft('movements')}
              onPayment={() => openDraft('payment')}
              onTopUp={() => openDraft('topUp')}
              onTransfer={() => openDraft('transferOut')}
              palette={palette}
            />
            <DebitCardManageActions
              onDelete={handleDeleteDebitCard}
              onEdit={openEditForm}
              palette={palette}
            />
            <RecurringIncomeCard card={selectedCard} palette={palette} />
            <MonthlyAnalysis card={selectedCard} palette={palette} />
            <WeeklyTrend card={selectedCard} palette={palette} />
            <MovementList card={selectedCard} palette={palette} />
          </>
        ) : null}
      </ScrollView>

      <BottomNavigation
        activeTab="more"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else if (action === 'settings') {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />

      <Pressable
        accessibilityRole="button"
        onPress={openCreateForm}
        style={[styles.fab, { backgroundColor: palette.primary }]}>
        <Text style={[styles.fabText, { color: palette.inverseText }]}>+</Text>
      </Pressable>

      <DebitCardFormModal
        input={formInput}
        onChange={setFormInput}
        onClose={() => {
          if (!formSaving) {
            setFormVisible(false);
          }
        }}
        onSave={handleSaveDebitCard}
        palette={palette}
        saving={formSaving}
        visible={formVisible}
      />
    </View>
  );
}

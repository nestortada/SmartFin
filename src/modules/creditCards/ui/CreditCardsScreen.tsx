import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import type { AppTheme } from '../../settings';
import { useCreditCardsOverview } from '../hooks';
import { createSqliteCreditCardRepository } from '../repositories';
import type { CreditCardSummary } from '../types';
import {
  deleteCreditCard,
  saveCreditCardFromForm,
} from '../useCases';
import { CreditCardFormModal } from './components/CreditCardFormModal';
import {
  CreditCardDatesCard,
  CreditCardLimitCard,
  InstallmentsSection,
  MinimumPaymentCard,
} from './components/CreditCardInsightCards';
import {
  CREDIT_CARD_PREVIEW_DIMENSIONS,
  CreditCardPreview,
} from './components/CreditCardPreview';
import {
  EMPTY_FORM_STATE,
  type CreditCardFormMode,
  type CreditCardFormState,
  type CreditCardsPalette,
} from './creditCardUiTypes';
import {
  formStateFromCard,
  toFormInput,
} from './creditCardFormatters';

const palettes: Record<AppTheme, CreditCardsPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255, 255, 255, 0.14)',
    card: 'rgba(255, 255, 255, 0.08)',
    cardStrong: 'rgba(255, 255, 255, 0.12)',
    danger: '#ffb4ab',
    dangerSoft: 'rgba(255, 180, 171, 0.12)',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    primaryStrong: '#3d5afe',
    secondary: '#cdbdff',
    surface: '#201f20',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(30, 36, 60, 0.12)',
    card: 'rgba(255, 255, 255, 0.78)',
    cardStrong: 'rgba(255, 255, 255, 0.94)',
    danger: '#a9362e',
    dangerSoft: 'rgba(169, 54, 46, 0.1)',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    primaryStrong: '#3d5afe',
    secondary: '#5203d5',
    surface: '#ffffff',
    tertiary: '#007f3e',
    text: '#18191f',
  },
};

type CreditCardsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenSettings: () => void;
  refreshKey?: number;
};

export function CreditCardsScreen({
  activeTheme,
  database,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenSettings,
  refreshKey = 0,
}: CreditCardsScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = palettes[activeTheme];
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const { error, loading, overview } = useCreditCardsOverview(database, refreshKey + localRefreshKey);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [formMode, setFormMode] = useState<CreditCardFormMode>('create');
  const [formCardId, setFormCardId] = useState<string>();
  const [formState, setFormState] = useState<CreditCardFormState>(EMPTY_FORM_STATE);
  const [isFormVisible, setIsFormVisible] = useState(false);
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
            await deleteCreditCard(createSqliteCreditCardRepository(database), formCardId);
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

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 140, paddingTop: insets.top + 18 },
        ]}
        style={styles.scrollView}>
        <Header palette={palette} />
        <LoadingState loading={loading} palette={palette} />
        <ErrorState error={error} palette={palette} />
        <EmptyState loading={loading} palette={palette} selectedCard={selectedCard} />

        {overview.cards.length > 0 ? (
          <CardCarousel
            cards={overview.cards}
            onAddCard={openCreateForm}
            onEditCard={openEditForm}
            palette={palette}
            selectedCardId={selectedCard?.account.id}
          />
        ) : null}

        {selectedCard ? (
          <>
            <CreditCardLimitCard card={selectedCard} palette={palette} />
            <CreditCardDatesCard card={selectedCard} palette={palette} />
            <MinimumPaymentCard card={selectedCard} palette={palette} />
            <InstallmentsSection card={selectedCard} palette={palette} />
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

      <BottomNavigation
        activeTab="more"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'settings') {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

function Header({ palette }: { palette: CreditCardsPalette }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={[styles.avatar, { backgroundColor: palette.primaryStrong, borderColor: palette.border }]}>
          <Text style={[styles.avatarText, { color: palette.text }]}>SF</Text>
        </View>
        <View>
          <Text style={[styles.appName, { color: palette.primary }]}>SmartFin</Text>
          <Text style={[styles.screenLabel, { color: palette.muted }]}>Tarjetas de credito</Text>
        </View>
      </View>
      <View style={[styles.headerIcon, { borderColor: palette.border }]}>
        <Text style={[styles.headerIconText, { color: palette.primary }]}>!</Text>
      </View>
    </View>
  );
}

function LoadingState({
  loading,
  palette,
}: {
  loading: boolean;
  palette: CreditCardsPalette;
}) {
  if (!loading) {
    return null;
  }

  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={palette.primary} size="small" />
      <Text style={[styles.loadingText, { color: palette.muted }]}>Cargando tarjetas...</Text>
    </View>
  );
}

function ErrorState({
  error,
  palette,
}: {
  error?: string;
  palette: CreditCardsPalette;
}) {
  if (!error) {
    return null;
  }

  return (
    <View style={[styles.statusCard, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
      <Text style={[styles.statusText, { color: palette.danger }]}>{error}</Text>
    </View>
  );
}

function EmptyState({
  loading,
  palette,
  selectedCard,
}: {
  loading: boolean;
  palette: CreditCardsPalette;
  selectedCard?: CreditCardSummary;
}) {
  if (loading || selectedCard) {
    return null;
  }

  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>No hay tarjetas activas</Text>
      <Text style={[styles.emptyBody, { color: palette.muted }]}>
        Agrega una cuenta de tipo tarjeta de credito para ver cupo, cuotas y pagos.
      </Text>
    </View>
  );
}

function CardCarousel({
  cards,
  onAddCard,
  onEditCard,
  palette,
  selectedCardId,
}: {
  cards: CreditCardSummary[];
  onAddCard: () => void;
  onEditCard: (card: CreditCardSummary) => void;
  palette: CreditCardsPalette;
  selectedCardId?: string;
}) {
  return (
    <View style={styles.carouselContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardSelector}>
        {cards.map((card, index) => {
          const isSelected = card.account.id === selectedCardId;

          return (
            <Pressable
              key={card.account.id}
              onPress={() => onEditCard(card)}
              style={[
                styles.creditCardPreview,
                {
                  backgroundColor: isSelected ? palette.cardStrong : palette.card,
                  borderColor: isSelected ? palette.primary : palette.border,
                  borderWidth: isSelected ? 2 : 1,
                  opacity: isSelected ? 1 : 0.78,
                  shadowColor: isSelected ? palette.primary : '#000000',
                  shadowOpacity: isSelected ? 0.26 : 0.12,
                  shadowRadius: isSelected ? 16 : 8,
                  shadowOffset: { width: 0, height: isSelected ? 10 : 4 },
                  elevation: isSelected ? 10 : 3,
                },
              ]}>
              <CreditCardPreview card={card} isPrimary={index === 0} palette={palette} />
            </Pressable>
          );
        })}

        <Pressable
          onPress={onAddCard}
          style={[
            styles.addCardBtn,
            {
              borderColor: palette.border,
              backgroundColor: 'rgba(255,255,255,0.02)',
            },
          ]}>
          <Text style={[styles.addCardIcon, { color: palette.muted }]}>+</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  addCardBtn: {
    alignItems: 'center',
    borderRadius: 22,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: CREDIT_CARD_PREVIEW_DIMENSIONS.compactHeight,
    justifyContent: 'center',
    width: 64,
  },
  addCardIcon: {
    fontSize: 24,
    fontWeight: '300',
  },
  appName: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  cardSelector: {
    gap: 12,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  carouselContainer: {
    marginHorizontal: -20,
  },
  content: {
    alignSelf: 'center',
    gap: 24,
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  creditCardPreview: {
    borderRadius: 22,
    borderWidth: 1,
    height: CREDIT_CARD_PREVIEW_DIMENSIONS.compactHeight,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: 16,
    width: CREDIT_CARD_PREVIEW_DIMENSIONS.compactWidth,
  },
  emptyBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  emptyCard: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '900',
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerIconText: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '700',
  },
  screen: {
    flex: 1,
  },
  screenLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 1,
    textTransform: 'uppercase',
  },
  scrollView: {
    flex: 1,
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});

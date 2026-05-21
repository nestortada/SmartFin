import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import { formatCurrency } from '../../../shared/utils/formatCurrency';
import type { AppTheme } from '../../settings';
import type { TransactionsInitialDraft } from '../../transactions/ui/TransactionsScreen';
import { createSqliteAccountRepository } from '../repositories';
import { useDebitCardsOverview } from '../hooks';
import {
  deleteDebitCard,
  parseDebitCardMetadata,
  saveDebitCardFromForm,
  type DebitCardFormInput,
  type DebitCardIncomeFrequency,
  type DebitCardIncomeType,
  type DebitCardMovement,
  type DebitCardSummary,
} from '../useCases';

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

type DebitCardsPalette = {
  background: string;
  border: string;
  card: string;
  danger: string;
  inverseText: string;
  muted: string;
  primary: string;
  secondary: string;
  tertiary: string;
  text: string;
};

const palettes: Record<AppTheme, DebitCardsPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255,255,255,0.12)',
    card: 'rgba(255,255,255,0.08)',
    danger: '#ffb4ab',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    secondary: '#cdbdff',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(35,42,65,0.12)',
    card: 'rgba(255,255,255,0.88)',
    danger: '#a93932',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    secondary: '#5203d5',
    tertiary: '#007f3e',
    text: '#19191d',
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
  const palette = palettes[activeTheme];
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const { error, loading, overview } = useDebitCardsOverview(database, refreshKey + localRefreshKey);
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [formVisible, setFormVisible] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formInput, setFormInput] = useState<DebitCardFormInput>({
    currentBalance: 0,
    name: '',
    recurringIncome: {
      amount: 0,
      frequency: 'none',
      incomeType: 'salary',
    },
  });

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
    setFormInput({
      currentBalance: 0,
      name: '',
      recurringIncome: {
        amount: 0,
        frequency: 'none',
        incomeType: 'salary',
      },
    });
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
      recurringIncome: metadata.recurringIncome ?? {
        amount: 0,
        frequency: 'none',
        incomeType: 'salary',
      },
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
      setLocalRefreshKey(current => current + 1);
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
              setLocalRefreshKey(current => current + 1);
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
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: palette.muted }]}>Saldo total disponible</Text>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[styles.totalBalance, { color: palette.text }]}>
              {formatCurrency(overview.totalAvailable, 'COP')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onOpenSettings}
            style={[styles.roundButton, { borderColor: palette.border }]}>
            <Text style={[styles.roundButtonText, { color: palette.primary }]}>AJ</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={palette.primary} size="small" />
            <Text style={[styles.statusText, { color: palette.muted }]}>Cargando tarjetas...</Text>
          </View>
        ) : null}

        {error ? (
          <Text style={[styles.statusText, { color: palette.danger }]}>{error}</Text>
        ) : null}

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
          <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No hay tarjetas debito</Text>
            <Text style={[styles.emptyText, { color: palette.muted }]}>
              Crea una cuenta bancaria o de ahorro para verla aqui.
            </Text>
          </View>
        )}

        {selectedCard ? (
          <>
            <QuickActions
              onMovements={() => openDraft('movements')}
              onPayment={() => openDraft('payment')}
              onTopUp={() => openDraft('topUp')}
              onTransfer={() => openDraft('transferOut')}
              palette={palette}
            />
            <View style={styles.manageActions}>
              <Pressable
                accessibilityRole="button"
                onPress={openEditForm}
                style={[styles.manageButton, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Text style={[styles.manageButtonText, { color: palette.primary }]}>Modificar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleDeleteDebitCard}
                style={[styles.manageButton, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Text style={[styles.manageButtonText, { color: palette.danger }]}>Eliminar</Text>
              </Pressable>
            </View>
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

function DebitCardPreview({
  card,
  onPress,
  palette,
  selected,
}: {
  card: DebitCardSummary;
  onPress: () => void;
  palette: DebitCardsPalette;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.debitCard,
        {
          backgroundColor: palette.card,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}>
      <View style={styles.cardGlowPrimary} />
      <View style={styles.cardGlowSecondary} />
      <View style={styles.cardTopRow}>
        <View>
          <Text style={[styles.cardBrand, { color: palette.text }]}>SmartFin</Text>
          <Text style={[styles.cardType, { color: palette.muted }]}>Debito Gold</Text>
        </View>
        <Text style={[styles.contactless, { color: palette.muted }]}>)))</Text>
      </View>
      <View style={styles.cardChip} />
      <View style={styles.cardBottomRow}>
        <View>
          <Text style={[styles.cardNumber, { color: palette.text }]}>{card.maskedNumber}</Text>
          <Text style={[styles.cardHolder, { color: palette.muted }]} numberOfLines={1}>
            {card.account.name}
          </Text>
        </View>
        <Text style={[styles.cardBalance, { color: palette.tertiary }]}>
          {formatCurrency(card.account.balance.amount, card.account.currency)}
        </Text>
      </View>
    </Pressable>
  );
}

function QuickActions({
  onMovements,
  onPayment,
  onTopUp,
  onTransfer,
  palette,
}: {
  onMovements: () => void;
  onPayment: () => void;
  onTopUp: () => void;
  onTransfer: () => void;
  palette: DebitCardsPalette;
}) {
  const actions = [
    { label: 'Transferir', onPress: onTransfer, symbol: 'TG' },
    { label: 'Pagar', onPress: onPayment, symbol: '$' },
    { label: 'Recargar', onPress: onTopUp, symbol: '+' },
    { label: 'Movimientos', onPress: onMovements, symbol: 'MV' },
  ];

  return (
    <View style={styles.quickActions}>
      {actions.map(action => (
        <Pressable
          accessibilityRole="button"
          key={action.label}
          onPress={action.onPress}
          style={styles.quickAction}>
          <View style={[styles.quickActionIcon, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.quickActionSymbol, { color: palette.primary }]}>{action.symbol}</Text>
          </View>
          <Text style={[styles.quickActionLabel, { color: palette.muted }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function RecurringIncomeCard({
  card,
  palette,
}: {
  card: DebitCardSummary;
  palette: DebitCardsPalette;
}) {
  const recurringIncome = card.recurringIncome;
  const frequencyLabel = recurringIncome?.frequency === 'biweekly'
    ? 'Cada 15 dias'
    : recurringIncome?.frequency === 'monthly'
      ? 'Cada mes'
      : recurringIncome?.frequency === 'specificDay'
        ? `Dia ${recurringIncome.dayOfMonth ?? 1}`
        : 'Sin ingreso programado';
  const incomeTypeLabel = recurringIncome?.incomeType === 'allowance'
    ? 'Mesada'
    : recurringIncome?.incomeType === 'business'
      ? 'Negocio'
      : recurringIncome?.incomeType === 'other'
        ? 'Otro'
        : 'Salario';

  return (
    <View style={[styles.recurringCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.metricLabel, { color: palette.muted }]}>Ingreso recurrente</Text>
        <Text style={[styles.recurringTitle, { color: palette.text }]}>{frequencyLabel}</Text>
      </View>
      <View style={styles.recurringRight}>
        <Text style={[styles.recurringAmount, { color: palette.tertiary }]}>
          {recurringIncome && recurringIncome.frequency !== 'none'
            ? formatCurrency(recurringIncome.amount, card.account.currency)
            : '$0'}
        </Text>
        <Text style={[styles.movementSubtitle, { color: palette.muted }]}>{incomeTypeLabel}</Text>
      </View>
    </View>
  );
}

function DebitCardFormModal({
  input,
  onChange,
  onClose,
  onSave,
  palette,
  saving,
  visible,
}: {
  input: DebitCardFormInput;
  onChange: (input: DebitCardFormInput) => void;
  onClose: () => void;
  onSave: () => void;
  palette: DebitCardsPalette;
  saving: boolean;
  visible: boolean;
}) {
  const recurringIncome = input.recurringIncome ?? {
    amount: 0,
    frequency: 'none' as DebitCardIncomeFrequency,
    incomeType: 'salary' as DebitCardIncomeType,
  };
  const updateRecurringIncome = (nextIncome: Partial<NonNullable<DebitCardFormInput['recurringIncome']>>) => {
    onChange({
      ...input,
      recurringIncome: {
        ...recurringIncome,
        ...nextIncome,
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.formSheet, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <View style={styles.formHeader}>
            <Text style={[styles.formTitle, { color: palette.text }]}>
              {input.accountId ? 'Modificar tarjeta debito' : 'Agregar tarjeta debito'}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={[styles.formClose, { color: palette.muted }]}>x</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <FormField
              label="Nombre"
              onChangeText={name => onChange({ ...input, name })}
              palette={palette}
              placeholder="Ej: Debito principal"
              value={input.name}
            />
            <FormField
              label="Banco"
              onChangeText={bankName => onChange({ ...input, bankName })}
              palette={palette}
              placeholder="Ej: Bancolombia"
              value={input.bankName ?? ''}
            />
            <FormField
              keyboardType="number-pad"
              label="Saldo actual"
              onChangeText={value => onChange({ ...input, currentBalance: parseMoneyInput(value) })}
              palette={palette}
              placeholder="0"
              value={input.currentBalance ? String(Math.round(input.currentBalance)) : ''}
            />

            <Text style={[styles.formSectionTitle, { color: palette.text }]}>Ingreso programado</Text>
            <SegmentedOptions
              options={[
                { label: 'No', value: 'none' },
                { label: '15 dias', value: 'biweekly' },
                { label: 'Mensual', value: 'monthly' },
                { label: 'Dia fijo', value: 'specificDay' },
              ]}
              onSelect={value => updateRecurringIncome({ frequency: value as DebitCardIncomeFrequency })}
              palette={palette}
              selected={recurringIncome.frequency}
            />
            {recurringIncome.frequency !== 'none' ? (
              <>
                <SegmentedOptions
                  options={[
                    { label: 'Salario', value: 'salary' },
                    { label: 'Mesada', value: 'allowance' },
                    { label: 'Negocio', value: 'business' },
                    { label: 'Otro', value: 'other' },
                  ]}
                  onSelect={value => updateRecurringIncome({ incomeType: value as DebitCardIncomeType })}
                  palette={palette}
                  selected={recurringIncome.incomeType}
                />
                <FormField
                  keyboardType="number-pad"
                  label="Monto esperado"
                  onChangeText={value => updateRecurringIncome({ amount: parseMoneyInput(value) })}
                  palette={palette}
                  placeholder="0"
                  value={recurringIncome.amount ? String(Math.round(recurringIncome.amount)) : ''}
                />
                {recurringIncome.frequency === 'specificDay' ? (
                  <FormField
                    keyboardType="number-pad"
                    label="Dia del mes"
                    onChangeText={value => updateRecurringIncome({ dayOfMonth: clampDay(Number(value) || 1) })}
                    palette={palette}
                    placeholder="1"
                    value={String(recurringIncome.dayOfMonth ?? 1)}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onSave}
            style={[styles.saveButton, { backgroundColor: palette.primary }]}>
            <Text style={[styles.saveButtonText, { color: palette.inverseText }]}>
              {saving ? 'Guardando...' : 'Guardar tarjeta'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FormField({
  keyboardType,
  label,
  onChangeText,
  palette,
  placeholder,
  value,
}: {
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  palette: DebitCardsPalette;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={[styles.formField, { borderColor: palette.border }]}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <TextInput
        keyboardType={keyboardType ?? 'default'}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.formInput, { color: palette.text }]}
        value={value}
      />
    </View>
  );
}

function SegmentedOptions({
  onSelect,
  options,
  palette,
  selected,
}: {
  onSelect: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  palette: DebitCardsPalette;
  selected: string;
}) {
  return (
    <View style={styles.segmentedRow}>
      {options.map(option => (
        <Pressable
          accessibilityRole="button"
          key={option.value}
          onPress={() => onSelect(option.value)}
          style={[
            styles.segmentedButton,
            {
              backgroundColor: selected === option.value ? palette.primary : palette.card,
              borderColor: selected === option.value ? palette.primary : palette.border,
            },
          ]}>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[
              styles.segmentedText,
              { color: selected === option.value ? palette.inverseText : palette.text },
            ]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function parseMoneyInput(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

function clampDay(day: number): number {
  return Math.min(31, Math.max(1, day));
}

function MonthlyAnalysis({
  card,
  palette,
}: {
  card: DebitCardSummary;
  palette: DebitCardsPalette;
}) {
  const { income, netFlow, payments, topUps, transfersOut } = card.monthlyMetrics;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>Analisis mensual</Text>
      <View style={[styles.metricWide, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>Flujo de caja</Text>
          <Text style={[styles.metricValue, { color: netFlow >= 0 ? palette.tertiary : palette.danger }]}>
            {formatCurrency(netFlow, card.account.currency)}
          </Text>
        </View>
        <View style={styles.miniBars}>
          {[income, topUps, payments, transfersOut, Math.abs(netFlow)].map((value, index) => (
            <View
              key={`${value}-${index}`}
              style={[
                styles.miniBar,
                {
                  backgroundColor: index < 2 ? palette.tertiary : palette.primary,
                  height: 14 + Math.min(42, value / 50000),
                },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={styles.metricsGrid}>
        <MetricCard label="Ingresos" palette={palette} value={income + topUps} tone="positive" />
        <MetricCard label="Pagos" palette={palette} value={payments} tone="primary" />
        <MetricCard label="Transferido" palette={palette} value={transfersOut} tone="secondary" />
        <MetricCard label="Movimientos" palette={palette} value={card.movements.length} tone="primary" compact />
      </View>
    </View>
  );
}

function MetricCard({
  compact,
  label,
  palette,
  tone,
  value,
}: {
  compact?: boolean;
  label: string;
  palette: DebitCardsPalette;
  tone: 'positive' | 'primary' | 'secondary';
  value: number;
}) {
  const color = tone === 'positive' ? palette.tertiary : tone === 'secondary' ? palette.secondary : palette.primary;

  return (
    <View style={[styles.metricCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.metricValueSmall, { color }]}>
        {compact ? value : formatCurrency(value, 'COP')}
      </Text>
      <View style={[styles.metricLine, { backgroundColor: `${color}55` }]} />
    </View>
  );
}

function WeeklyTrend({
  card,
  palette,
}: {
  card: DebitCardSummary;
  palette: DebitCardsPalette;
}) {
  const maxValue = Math.max(...card.weeklyTrend.map(point => Math.abs(point.netAmount)), 1);

  return (
    <View style={[styles.trendCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Tendencia semanal</Text>
        <Text style={[styles.trendHint, { color: palette.muted }]}>Neto diario</Text>
      </View>
      <View style={styles.trendBars}>
        {card.weeklyTrend.map(point => {
          const height = 12 + (Math.abs(point.netAmount) / maxValue) * 76;
          return (
            <View key={point.date} style={styles.trendColumn}>
              <View
                style={[
                  styles.trendBar,
                  {
                    backgroundColor: point.netAmount >= 0 ? palette.tertiary : palette.primary,
                    height,
                  },
                ]}
              />
              <Text style={[styles.trendLabel, { color: palette.muted }]}>{point.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MovementList({
  card,
  palette,
}: {
  card: DebitCardSummary;
  palette: DebitCardsPalette;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>Movimientos</Text>
      {card.movements.slice(0, 8).map(movement => (
        <MovementRow
          key={movement.transaction.id}
          movement={movement}
          palette={palette}
        />
      ))}
      {card.movements.length === 0 ? (
        <Text style={[styles.statusText, { color: palette.muted }]}>Aun no hay movimientos para esta tarjeta.</Text>
      ) : null}
    </View>
  );
}

function MovementRow({
  movement,
  palette,
}: {
  movement: DebitCardMovement;
  palette: DebitCardsPalette;
}) {
  const isPositive = movement.signedAmount >= 0;

  return (
    <View style={[styles.movementRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.movementIcon, { backgroundColor: isPositive ? 'rgba(0,228,117,0.12)' : 'rgba(187,195,255,0.12)' }]}>
        <Text style={[styles.movementIconText, { color: isPositive ? palette.tertiary : palette.primary }]}>
          {isPositive ? '+' : '-'}
        </Text>
      </View>
      <View style={styles.movementTextBlock}>
        <Text numberOfLines={1} style={[styles.movementTitle, { color: palette.text }]}>
          {movement.transaction.merchantName || movement.transaction.description}
        </Text>
        <Text style={[styles.movementSubtitle, { color: palette.muted }]}>
          {movement.kind} - {movement.transaction.date.slice(0, 10)}
        </Text>
      </View>
      <Text style={[styles.movementAmount, { color: isPositive ? palette.tertiary : palette.primary }]}>
        {isPositive ? '+' : '-'}{formatCurrency(Math.abs(movement.signedAmount), movement.transaction.currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardBalance: {
    fontSize: 12,
    fontWeight: '900',
    maxWidth: 118,
    textAlign: 'right',
  },
  cardBottomRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  cardBrand: {
    fontSize: 18,
    fontWeight: '900',
  },
  cardChip: {
    backgroundColor: '#d1d5db',
    borderRadius: 5,
    height: 32,
    width: 44,
    zIndex: 2,
  },
  cardGlowPrimary: {
    backgroundColor: 'rgba(187,195,255,0.20)',
    borderRadius: 80,
    height: 120,
    position: 'absolute',
    right: -44,
    top: -44,
    width: 120,
  },
  cardGlowSecondary: {
    backgroundColor: 'rgba(205,189,255,0.18)',
    borderRadius: 80,
    bottom: -48,
    height: 128,
    left: -48,
    position: 'absolute',
    width: 128,
  },
  cardHolder: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 4,
    maxWidth: 170,
    textTransform: 'uppercase',
  },
  cardNumber: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 4,
  },
  cardRail: {
    gap: 14,
    paddingRight: 20,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  cardType: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  contactless: {
    fontSize: 20,
    fontWeight: '900',
  },
  content: {
    alignSelf: 'center',
    gap: 24,
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  debitCard: {
    aspectRatio: 1.586,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: 20,
    width: 310,
  },
  emptyCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 18,
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
  fabText: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 28,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  formClose: {
    fontSize: 22,
    fontWeight: '900',
  },
  formContent: {
    gap: 12,
    padding: 18,
  },
  formField: {
    borderBottomWidth: 1,
    gap: 4,
    paddingVertical: 10,
  },
  formHeader: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255,255,255,0.10)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  formInput: {
    fontSize: 17,
    fontWeight: '800',
    minHeight: 36,
    padding: 0,
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 6,
  },
  formSheet: {
    alignSelf: 'center',
    borderWidth: 1,
    flex: 1,
    maxWidth: 560,
    width: '100%',
  },
  formTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '900',
  },
  manageActions: {
    flexDirection: 'row',
    gap: 12,
  },
  manageButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  manageButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  metricCard: {
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    minHeight: 92,
    padding: 14,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  metricLine: {
    borderRadius: 2,
    height: 4,
    marginTop: 12,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  metricValueSmall: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
  },
  metricWide: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  miniBar: {
    borderRadius: 4,
    width: 10,
  },
  miniBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 5,
    height: 64,
  },
  movementAmount: {
    fontSize: 13,
    fontWeight: '900',
    maxWidth: 112,
    textAlign: 'right',
  },
  movementIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  movementIconText: {
    fontSize: 18,
    fontWeight: '900',
  },
  movementRow: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  movementSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  movementTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  movementTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  modalOverlay: {
    backgroundColor: 'rgba(5,4,8,0.78)',
    flex: 1,
  },
  quickAction: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  quickActionIcon: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  quickActionLabel: {
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  quickActionSymbol: {
    fontSize: 14,
    fontWeight: '900',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  recurringAmount: {
    fontSize: 16,
    fontWeight: '900',
  },
  recurringCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  recurringRight: {
    alignItems: 'flex-end',
  },
  recurringTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 3,
  },
  roundButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  roundButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 56,
    justifyContent: 'center',
    margin: 18,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '900',
  },
  segmentedButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 42,
    minWidth: 74,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  segmentedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentedText: {
    fontSize: 12,
    fontWeight: '900',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
  },
  totalBalance: {
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 42,
    marginTop: 4,
  },
  trendBar: {
    borderRadius: 8,
    minHeight: 8,
    width: 20,
  },
  trendBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 12,
    height: 122,
    justifyContent: 'space-between',
  },
  trendCard: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  trendColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'flex-end',
  },
  trendHint: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  trendLabel: {
    fontSize: 9,
    fontWeight: '900',
  },
});

import React from 'react';
import { Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type { DebitCardMovement, DebitCardSummary } from '../../useCases';
import { debitCardsStyles as styles } from '../debitCardsStyles';
import type { DebitCardsPalette } from '../debitCardsPalette';

export function RecurringIncomeCard({
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

export function MonthlyAnalysis({
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

export function WeeklyTrend({
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

export function MovementList({
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

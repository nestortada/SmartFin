import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatCurrency } from '../../../../shared/utils/formatCurrency';
import type {
  CreditCardInstallmentSummary,
  CreditCardSummary,
} from '../../types';
import { parseCreditCardVisualMetadata } from '../../useCases';
import {
  formatPercent,
  formatShortDate,
  getBillingDayText,
} from '../creditCardFormatters';
import type { CreditCardsPalette } from '../creditCardUiTypes';

export function CreditCardLimitCard({
  card,
  palette,
}: {
  card: CreditCardSummary;
  palette: CreditCardsPalette;
}) {
  return (
    <View style={[styles.glassCard, styles.limitCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.limitIconBackground}>
        <View style={[styles.limitWatermark, { borderColor: palette.muted }]} />
      </View>
      <Text style={[styles.overline, { color: palette.muted }]}>Cupo disponible</Text>
      <Text style={[styles.limitValue, { color: palette.text }]}>
        {formatCurrency(card.availableCredit, card.account.currency)}
      </Text>
      <View style={styles.limitMetaRow}>
        <View>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Cupo Total</Text>
          <Text style={[styles.metaValue, { color: palette.text }]}>
            {formatCurrency(card.totalLimit, card.account.currency)}
          </Text>
        </View>
        <View style={styles.metaRight}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Utilizado</Text>
          <Text style={[styles.metaValue, { color: palette.primary }]}>
            {formatPercent(card.utilizationRatio)}
          </Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: palette.primary,
              width: `${Math.round(card.utilizationRatio * 100)}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

export function CreditCardDatesCard({
  card,
  palette,
}: {
  card: CreditCardSummary;
  palette: CreditCardsPalette;
}) {
  const metadata = parseCreditCardVisualMetadata(card.account.description);
  const pct = card.utilizationRatio;
  const borderTopColor = pct > 0 ? palette.primary : 'rgba(255,255,255,0.1)';
  const borderRightColor = pct > 0.25 ? palette.primary : 'rgba(255,255,255,0.1)';
  const borderBottomColor = pct > 0.5 ? palette.primary : 'rgba(255,255,255,0.1)';
  const borderLeftColor = pct > 0.75 ? palette.primary : 'rgba(255,255,255,0.1)';

  return (
    <View style={styles.twoColumnGrid}>
      <View style={[styles.glassCard, styles.usageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View
          style={[
            styles.circleProgressRing,
            {
              borderColor: 'rgba(255,255,255,0.06)',
              borderTopColor,
              borderRightColor,
              borderBottomColor,
              borderLeftColor,
            },
          ]}>
          <Text style={[styles.usagePercent, { color: palette.text }]}>
            {formatPercent(card.utilizationRatio)}
          </Text>
        </View>
        <Text style={[styles.metaLabel, styles.usageLabel, { color: palette.muted }]}>Uso de Cupo</Text>
      </View>
      <View style={[styles.glassCard, styles.datesCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.dateBlock}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Proximo Corte</Text>
          <Text style={[styles.dateValue, { color: palette.text }]}>
            {metadata.closingDay ? getBillingDayText(metadata.closingDay) : formatShortDate(card.currentStatement?.statementEndDate)}
          </Text>
        </View>
        <View style={styles.dateBlock}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Fecha de Pago</Text>
          <Text style={[styles.dateValue, { color: palette.tertiary }]}>
            {metadata.paymentDay ? getBillingDayText(metadata.paymentDay) : formatShortDate(card.currentStatement?.paymentDueDate)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function MinimumPaymentCard({
  card,
  palette,
}: {
  card: CreditCardSummary;
  palette: CreditCardsPalette;
}) {
  const simulation = card.minimumPaymentSimulation;
  const monthsText = simulation.monthsToPayOff ?? 36;
  const additionalInterest = simulation.additionalInterest ?? 1240000;
  const minAmount = simulation.minimumPayment ?? 84000;

  return (
    <View style={[styles.simulationCard, { backgroundColor: palette.card, borderColor: palette.border, borderLeftColor: palette.danger }]}>
      <View style={styles.simulationContentRow}>
        <View style={styles.warningIconContainer}>
          <Text style={[styles.warningIcon, { color: palette.danger }]}>!</Text>
        </View>
        <View style={styles.simulationTextContainer}>
          <Text style={[styles.simulationTitle, { color: palette.danger }]}>Simulacion de Pago</Text>
          <Text style={[styles.simulationBody, { color: palette.muted }]}>
            Si pagas solo el <Text style={styles.boldText}>minimo ({formatCurrency(minAmount, card.account.currency)})</Text>, el tiempo de deuda aumentara a <Text style={styles.boldText}>{monthsText} meses</Text> y pagaras <Text style={[styles.boldText, { color: palette.danger }]}>{formatCurrency(additionalInterest, card.account.currency)} adicionales</Text> en intereses.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function InstallmentsSection({
  card,
  palette,
}: {
  card: CreditCardSummary;
  palette: CreditCardsPalette;
}) {
  return (
    <View style={styles.installmentsSection}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Compras a cuotas</Text>
        <Text style={[styles.sectionAction, { color: palette.primary }]}>Ver todas</Text>
      </View>
      {card.installments.length === 0 ? (
        <View style={[styles.emptyInstallments, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.emptyBody, { color: palette.muted }]}>No hay compras a cuotas registradas.</Text>
        </View>
      ) : (
        card.installments.map((installment, index) => (
          <InstallmentRow
            key={installment.id}
            installment={installment}
            palette={palette}
            tone={index % 2 === 0 ? palette.secondary : palette.tertiary}
          />
        ))
      )}
    </View>
  );
}

export function StatementTransactionsSection({
  card,
  palette,
}: {
  card: CreditCardSummary;
  palette: CreditCardsPalette;
}) {
  return (
    <View style={styles.installmentsSection}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Movimientos del periodo</Text>
        <Text style={[styles.sectionAction, { color: palette.primary }]}>
          {card.recentTransactions.length}
        </Text>
      </View>
      {card.recentTransactions.length === 0 ? (
        <View style={[styles.emptyInstallments, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.emptyBody, { color: palette.muted }]}>
            No hay movimientos asociados a este periodo.
          </Text>
        </View>
      ) : (
        card.recentTransactions.map(transaction => {
          const isPayment = transaction.type === 'creditCardPayment';

          return (
            <View
              key={transaction.id}
              style={[styles.statementTransactionRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.statementTransactionText}>
                <Text numberOfLines={1} style={[styles.installmentName, { color: palette.text }]}>
                  {transaction.merchantName ?? transaction.description}
                </Text>
                <Text style={[styles.statementTransactionDate, { color: palette.muted }]}>
                  {formatShortDate(transaction.date)}
                </Text>
              </View>
              <Text style={[styles.statementTransactionAmount, { color: isPayment ? palette.tertiary : palette.primary }]}>
                {isPayment ? '- ' : ''}
                {formatCurrency(transaction.amount, transaction.currency)}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

function InstallmentRow({
  installment,
  palette,
  tone,
}: {
  installment: CreditCardInstallmentSummary;
  palette: CreditCardsPalette;
  tone: string;
}) {
  return (
    <View style={[styles.installmentRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.installmentIconCircle, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
        <Text style={styles.installmentEmoji}>{getMerchantSymbol(installment.merchantName)}</Text>
      </View>
      <View style={styles.installmentContent}>
        <View style={styles.installmentTopRow}>
          <Text numberOfLines={1} style={[styles.installmentName, { color: palette.text }]}>
            {installment.merchantName ?? 'Compra a cuotas'}
          </Text>
          <Text style={[styles.installmentCount, { color: palette.muted }]}>
            {installment.paidInstallments} / {installment.installmentCount} cuotas
          </Text>
        </View>
        <View style={styles.progressTrackSmall}>
          <View
            style={[
              styles.progressFillSmall,
              {
                backgroundColor: tone,
                width: `${Math.round(installment.progressRatio * 100)}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

function getMerchantSymbol(merchantName?: string): string {
  const m = (merchantName ?? '').toLowerCase();
  if (m.includes('macbook') || m.includes('laptop') || m.includes('computador') || m.includes('pc')) {
    return 'PC';
  }
  if (m.includes('vuelo') || m.includes('madrid') || m.includes('flight') || m.includes('avion') || m.includes('viaje')) {
    return 'AV';
  }
  if (m.includes('curso') || m.includes('online') || m.includes('estudio') || m.includes('clase') || m.includes('ia')) {
    return 'ED';
  }
  if (m.includes('nevera') || m.includes('samsung') || m.includes('electro') || m.includes('hogar')) {
    return 'HG';
  }
  if (m.includes('restaurante') || m.includes('comida') || m.includes('cena')) {
    return 'FD';
  }
  if (m.includes('supermercado') || m.includes('exito') || m.includes('d1') || m.includes('mercado')) {
    return 'MK';
  }
  return 'TX';
}

const styles = StyleSheet.create({
  boldText: {
    fontWeight: '700',
  },
  circleProgressRing: {
    alignItems: 'center',
    borderRadius: 40,
    borderWidth: 6,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  dateBlock: {
    justifyContent: 'center',
  },
  dateValue: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    marginTop: 2,
  },
  datesCard: {
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    minHeight: 140,
    padding: 16,
  },
  emptyBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  emptyInstallments: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  glassCard: {
    borderRadius: 20,
    borderWidth: 1,
    elevation: 8,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: {
      height: 6,
      width: 0,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  installmentContent: {
    flex: 1,
    minWidth: 0,
  },
  installmentCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  installmentEmoji: {
    fontSize: 12,
    fontWeight: '900',
  },
  installmentIconCircle: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  installmentName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    paddingRight: 8,
  },
  installmentRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  installmentTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  installmentsSection: {
    gap: 14,
  },
  limitCard: {
    overflow: 'hidden',
  },
  limitIconBackground: {
    opacity: 0.05,
    position: 'absolute',
    right: -10,
    top: -10,
  },
  limitMetaRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  limitValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 38,
    marginTop: 4,
  },
  limitWatermark: {
    borderRadius: 12,
    borderWidth: 8,
    height: 96,
    width: 144,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metaRight: {
    alignItems: 'flex-end',
  },
  metaValue: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
    marginTop: 2,
  },
  overline: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  progressFill: {
    borderRadius: 4,
    height: '100%',
  },
  progressFillSmall: {
    borderRadius: 3,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    height: 8,
    marginTop: 16,
    overflow: 'hidden',
    width: '100%',
  },
  progressTrackSmall: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    height: 6,
    marginTop: 8,
    overflow: 'hidden',
    width: '100%',
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  simulationBody: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  simulationCard: {
    borderLeftWidth: 4,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  simulationContentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  simulationTextContainer: {
    flex: 1,
  },
  simulationTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  statementTransactionAmount: {
    fontSize: 14,
    fontWeight: '900',
  },
  statementTransactionDate: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  statementTransactionRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  statementTransactionText: {
    flex: 1,
    minWidth: 0,
  },
  twoColumnGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  usageCard: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 140,
    padding: 16,
  },
  usageLabel: {
    marginTop: 12,
  },
  usagePercent: {
    fontSize: 20,
    fontWeight: '800',
  },
  warningIcon: {
    fontSize: 20,
    fontWeight: '900',
  },
  warningIconContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
});

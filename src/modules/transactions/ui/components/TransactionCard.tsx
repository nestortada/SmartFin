import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Transaction } from '../../types';

type ThemeColors = {
  border: string;
  card: string;
  muted: string;
  tertiary: string;
  text: string;
};

type TransactionCardProps = {
  tx: Transaction;
  isDark: boolean;
  themeColors: ThemeColors;
  categories: Array<{
    color?: string;
    id: string;
    macroCategory: string;
    name: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type?: string;
  }>;
  onEditInstallments: (tx: Transaction) => void;
  onShowOpTypeDropdown: (tx: Transaction) => void;
  onPress?: (tx: Transaction) => void;
};

export const TransactionCard: React.FC<TransactionCardProps> = ({
  tx,
  isDark,
  themeColors,
  categories,
  accounts,
  onEditInstallments,
  onShowOpTypeDropdown,
  onPress,
}) => {
  const getCategoryIcon = (macro: string): string => {
    switch (macro) {
      case 'income':
        return '$';
      case 'food':
        return 'FO';
      case 'transport':
        return 'TR';
      case 'housing':
        return 'HO';
      case 'entertainment':
        return 'EN';
      case 'health':
        return 'SA';
      case 'utilities':
        return 'SE';
      case 'debts':
        return 'DE';
      case 'investments':
        return 'IN';
      default:
        return 'OT';
    }
  };

  const getCategoryInfo = (categoryId?: string) => {
    const cat = categories.find(c => c.id === categoryId);
    if (cat) {
      return {
        color: cat.color || '#cdbdff',
        icon: getCategoryIcon(cat.macroCategory),
        name: cat.name,
      };
    }

    return {
      color: '#c5c5d9',
      icon: 'OT',
      name: 'Otros',
    };
  };

  const getAccountInfo = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    return acc ? acc.name : 'Cuenta';
  };

  const getOperationType = (transaction: Transaction) => {
    if (transaction.paymentMethod === 'credit') {
      return 'credit';
    }
    const account = accounts.find(candidate => candidate.id === transaction.accountId);
    if (account?.type === 'creditCard') {
      return 'credit';
    }

    if (
      transaction.notes?.startsWith('Credito •') ||
      transaction.notes?.startsWith('Crédito •') ||
      transaction.notes?.startsWith('CrÃ©dito â€¢') ||
      transaction.notes?.startsWith('CrÃƒÂ©dito Ã¢â‚¬Â¢')
    ) {
      return 'credit';
    }

    return 'debit';
  };

  const getInstallmentDetails = (transaction: Transaction) => {
    const installmentMatch = transaction.notes?.match(/Cuotas:\s*(\d+)/i);
    const installmentCount = Number(installmentMatch?.[1]) || 1;

    return {
      installmentCount,
    };
  };

  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      currency: 'COP',
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(val);
  };

  const catInfo = getCategoryInfo(tx.categoryId);
  const isIncome = tx.direction === 'inflow';
  const operationType = getOperationType(tx);
  const installmentDetails = getInstallmentDetails(tx);
  const isSmsDetected = Boolean(
    tx.notes &&
      (tx.notes.toUpperCase().includes('SMS') ||
        tx.notes.includes('Registro de SMS') ||
        tx.description.toUpperCase().includes('UNIVERSIDAD DE LA SABA') ||
        tx.notes.toUpperCase().includes('NOTIFICACION')),
  );

  return (
    <Pressable
      onPress={() => onPress?.(tx)}
      style={({ pressed }) => [
        styles.txCard,
        { backgroundColor: themeColors.card, borderColor: themeColors.border },
        pressed && { opacity: 0.82, transform: [{ scale: 0.985 }] },
      ]}>
      <View style={[styles.catIconContainer, { backgroundColor: `${catInfo.color}22`, borderColor: catInfo.color }]}>
        <Text style={[styles.catEmoji, { color: catInfo.color }]}>{catInfo.icon}</Text>
      </View>

      <View style={styles.txDetails}>
        <Text numberOfLines={1} style={[styles.txTitle, { color: themeColors.text }]}>
          {tx.merchantName || tx.description}
        </Text>
        <View style={styles.subrow}>
          <View style={[styles.catBadge, { backgroundColor: `${catInfo.color}33` }]}>
            <Text style={[styles.catBadgeText, { color: catInfo.color }]}>
              {catInfo.name.toUpperCase()}
            </Text>
          </View>
          <Text numberOfLines={1} style={[styles.accText, { color: themeColors.muted }]}>
            {getAccountInfo(tx.accountId)}
          </Text>
        </View>

        {isSmsDetected ? (
          <View style={styles.smsBadge}>
            <Text style={styles.smsBadgeIcon}>SMS</Text>
            <Text style={styles.smsBadgeText}>DETECTADO POR SMS</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.txRight}>
        <View style={styles.paymentChipRow}>
          <Pressable
            onPress={() => onShowOpTypeDropdown(tx)}
            style={[
              styles.cardOpDropdown,
              {
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                borderColor: themeColors.border,
              },
            ]}>
            <Text style={[styles.cardOpDropdownText, { color: themeColors.text }]}>
              {operationType === 'credit' ? '💳 Crédito' : '💳 Débito'}
            </Text>
          </Pressable>

          {operationType === 'credit' ? (
            <Pressable
              onPress={() => onEditInstallments(tx)}
              style={[
                styles.installmentDropdown,
                {
                  backgroundColor: isDark ? 'rgba(187, 195, 255, 0.12)' : 'rgba(40, 72, 238, 0.08)',
                  borderColor: themeColors.border,
                },
              ]}>
              <Text style={[styles.cardOpDropdownText, { color: themeColors.text }]}>
                {installmentDetails.installmentCount}x
              </Text>
              <Text style={[styles.cardOpDropdownArrow, { color: themeColors.muted }]}>▾</Text>
            </Pressable>
          ) : null}
        </View>

        <Text
          style={[
            styles.txValue,
            { color: isIncome ? themeColors.tertiary : themeColors.text },
          ]}>
          {isIncome ? '+' : '-'} {formatCOP(tx.amount)}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  accText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  cardOpDropdown: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  cardOpDropdownArrow: {
    fontSize: 9,
  },
  cardOpDropdownText: {
    fontSize: 9,
    fontWeight: '800',
  },
  catBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  catBadgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  catEmoji: {
    fontSize: 11,
    fontWeight: '900',
  },
  catIconContainer: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    marginTop: 4,
    width: 30,
  },
  installmentDropdown: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  paymentChipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  smsBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 228, 117, 0.08)',
    borderColor: 'rgba(0, 228, 117, 0.3)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  smsBadgeIcon: {
    color: '#00e475',
    fontSize: 8,
    fontWeight: '900',
  },
  smsBadgeText: {
    color: '#00e475',
    fontSize: 8,
    fontWeight: '800',
  },
  subrow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  txCard: {
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 12,
  },
  txDetails: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 12,
    minWidth: 0,
    paddingRight: 8,
  },
  txRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    maxWidth: 150,
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  txValue: {
    fontSize: 14,
    fontWeight: '800',
  },
});

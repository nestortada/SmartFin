import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import type { Transaction } from '../../types';

type TransactionCardProps = {
  tx: Transaction;
  isDark: boolean;
  themeColors: any;
  categories: any[];
  accounts: any[];
  onShowOpTypeDropdown: (tx: Transaction) => void;
};

export const TransactionCard: React.FC<TransactionCardProps> = ({
  tx,
  isDark,
  themeColors,
  categories,
  accounts,
  onShowOpTypeDropdown,
}) => {
  const getCategoryIcon = (macro: string): string => {
    switch (macro) {
      case 'income': return '💵';
      case 'food': return '🍔';
      case 'transport': return '🚗';
      case 'housing': return '🏠';
      case 'entertainment': return '🍿';
      case 'health': return '💊';
      case 'utilities': return '💡';
      case 'debts': return '💳';
      case 'investments': return '📈';
      default: return '📦';
    }
  };

  const getCategoryInfo = (categoryId?: string) => {
    const cat = categories.find(c => c.id === categoryId);
    if (cat) {
      return {
        name: cat.name,
        color: cat.color || '#cdbdff',
        icon: getCategoryIcon(cat.macroCategory),
      };
    }
    return {
      name: 'Otros',
      color: '#c5c5d9',
      icon: '📦',
    };
  };

  const getAccountInfo = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    return acc ? acc.name : 'Cuenta';
  };

  const getOperationType = (transaction: Transaction) => {
    if (transaction.notes && transaction.notes.startsWith('Crédito •')) return 'Créd';
    return 'Deb';
  };

  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(val);
  };

  const catInfo = getCategoryInfo(tx.categoryId);
  const isIncome = tx.direction === 'inflow';
  const isSmsDetected = tx.notes && (
    tx.notes.toUpperCase().includes('SMS') ||
    tx.notes.includes('Registro de SMS') ||
    tx.description.toUpperCase().includes('UNIVERSIDAD DE LA SABA') ||
    tx.notes.toUpperCase().includes('NOTIFICACION')
  );

  return (
    <View
      style={[
        styles.txCard,
        { backgroundColor: themeColors.card, borderColor: themeColors.border },
      ]}>
      {/* Category Circle Icon */}
      <View style={[styles.catIconContainer, { backgroundColor: catInfo.color + '22', borderColor: catInfo.color }]}>
        <Text style={styles.catEmoji}>{catInfo.icon}</Text>
      </View>

      {/* Text details */}
      <View style={styles.txDetails}>
        <Text numberOfLines={1} style={[styles.txTitle, { color: themeColors.text }]}>
          {tx.merchantName || tx.description}
        </Text>
        <View style={styles.subrow}>
          <View style={[styles.catBadge, { backgroundColor: catInfo.color + '33' }]}>
            <Text style={[styles.catBadgeText, { color: catInfo.color }]}>
              {catInfo.name.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.accText, { color: themeColors.muted }]}>
            {getAccountInfo(tx.accountId)}
          </Text>
        </View>

        {/* Glowing DETECTADO POR SMS badge */}
        {isSmsDetected ? (
          <View style={styles.smsBadge}>
            <Text style={styles.smsBadgeIcon}>📱</Text>
            <Text style={styles.smsBadgeText}>DETECTADO POR SMS</Text>
          </View>
        ) : null}
      </View>

      {/* Value */}
      <View style={styles.txRight}>
        {/* Tiny inline dropdown above the price */}
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
            {getOperationType(tx) === 'Créd' ? '💳 Crédito' : '💳 Débito'}
          </Text>
          <Text style={[styles.cardOpDropdownArrow, { color: themeColors.muted }]}> ▾</Text>
        </Pressable>

        <Text
          style={[
            styles.txValue,
            { color: isIncome ? themeColors.tertiary : themeColors.text },
          ]}>
          {isIncome ? '+' : '-'} {formatCOP(tx.amount)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  accText: {
    fontSize: 12,
    fontWeight: '500',
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
    fontSize: 16,
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
    fontSize: 8,
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
    paddingRight: 8,
  },
  txRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cardOpDropdown: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  cardOpDropdownText: {
    fontSize: 9,
    fontWeight: '800',
  },
  cardOpDropdownArrow: {
    fontSize: 9,
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

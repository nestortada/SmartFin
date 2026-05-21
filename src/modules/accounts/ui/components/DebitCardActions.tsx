import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { debitCardsStyles as styles } from '../debitCardsStyles';
import type { DebitCardsPalette } from '../debitCardsPalette';

type DebitCardQuickActionsProps = {
  onMovements: () => void;
  onPayment: () => void;
  onTopUp: () => void;
  onTransfer: () => void;
  palette: DebitCardsPalette;
};

export function DebitCardQuickActions({
  onMovements,
  onPayment,
  onTopUp,
  onTransfer,
  palette,
}: DebitCardQuickActionsProps) {
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

type DebitCardManageActionsProps = {
  onDelete: () => void;
  onEdit: () => void;
  palette: DebitCardsPalette;
};

export function DebitCardManageActions({
  onDelete,
  onEdit,
  palette,
}: DebitCardManageActionsProps) {
  return (
    <View style={styles.manageActions}>
      <Pressable
        accessibilityRole="button"
        onPress={onEdit}
        style={[styles.manageButton, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Text style={[styles.manageButtonText, { color: palette.primary }]}>Modificar</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onDelete}
        style={[styles.manageButton, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Text style={[styles.manageButtonText, { color: palette.danger }]}>Eliminar</Text>
      </Pressable>
    </View>
  );
}

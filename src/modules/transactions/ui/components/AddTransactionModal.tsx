import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TransactionType } from '../../types';

type AddTransactionModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  categories: any[];
  accounts: any[];
  newAmount: string;
  setNewAmount: (val: string) => void;
  newMerchant: string;
  setNewMerchant: (val: string) => void;
  newType: TransactionType;
  setNewType: (val: TransactionType) => void;
  newCategory: string;
  setNewCategory: (val: string) => void;
  newAccount: string;
  setNewAccount: (val: string) => void;
  newNotes: string;
  setNewNotes: (val: string) => void;
  newOperationType: 'Débito' | 'Crédito';
  setNewOperationType: (val: 'Débito' | 'Crédito') => void;
  opTypePickerVisible: boolean;
  setOpTypePickerVisible: (val: boolean) => void;
  onSave: () => void;
};

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  visible,
  onClose,
  isDark,
  themeColors,
  categories,
  accounts,
  newAmount,
  setNewAmount,
  newMerchant,
  setNewMerchant,
  newType,
  setNewType,
  newCategory,
  setNewCategory,
  newAccount,
  setNewAccount,
  newNotes,
  setNewNotes,
  newOperationType,
  setNewOperationType,
  opTypePickerVisible,
  setOpTypePickerVisible,
  onSave,
}) => {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.glassModalLarge, { backgroundColor: isDark ? '#161420' : '#fff', borderColor: themeColors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>Nuevo Movimiento</Text>
            <Pressable onPress={onClose}>
              <Text style={[styles.modalCloseIcon, { color: themeColors.muted }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.formContainer}>
            {/* Operation Type Selector (Débito / Crédito) */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Tipo de Operación *</Text>
            <Pressable
              onPress={() => setOpTypePickerVisible(true)}
              style={[styles.formDropdownTrigger, { borderColor: themeColors.border, backgroundColor: 'rgba(255,255,255,0.06)' }]}>
              <Text style={{ color: themeColors.text, fontSize: 14, fontWeight: '700' }}>
                {newOperationType === 'Débito' ? '💳 Débito' : '💳 Crédito'}
              </Text>
              <Text style={[styles.chevronDown, { color: themeColors.muted, fontSize: 14 }]}>▾</Text>
            </Pressable>

            {/* Income / Expense toggle buttons */}
            <View style={styles.formToggle}>
              <Pressable
                onPress={() => setNewType('expense')}
                style={[
                  styles.toggleBtn,
                  newType === 'expense' && { backgroundColor: themeColors.danger + '33', borderColor: themeColors.danger },
                ]}>
                <Text style={[styles.toggleBtnText, { color: newType === 'expense' ? themeColors.danger : themeColors.muted }]}>Gasto 🔴</Text>
              </Pressable>
              <Pressable
                onPress={() => setNewType('income')}
                style={[
                  styles.toggleBtn,
                  newType === 'income' && { backgroundColor: themeColors.tertiary + '33', borderColor: themeColors.tertiary },
                ]}>
                <Text style={[styles.toggleBtnText, { color: newType === 'income' ? themeColors.tertiary : themeColors.muted }]}>Ingreso 🟢</Text>
              </Pressable>
            </View>

            {/* Amount input */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Monto (COP) *</Text>
            <TextInput
              placeholder="Ej. 12000"
              placeholderTextColor={themeColors.muted}
              keyboardType="numeric"
              value={newAmount}
              onChangeText={setNewAmount}
              style={[styles.formInput, { color: themeColors.text, borderColor: themeColors.border }]}
            />

            {/* Merchant / Description input */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Comercio o Concepto *</Text>
            <TextInput
              placeholder="Ej. Almuerzo Sabor, Pago Nómina"
              placeholderTextColor={themeColors.muted}
              value={newMerchant}
              onChangeText={setNewMerchant}
              style={[styles.formInput, { color: themeColors.text, borderColor: themeColors.border }]}
            />

            {/* Category picker list */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Categoría</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.formHorizonList}>
              {categories.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => setNewCategory(c.id)}
                  style={[
                    styles.horizonChip,
                    newCategory === c.id && { backgroundColor: themeColors.primary + '33', borderColor: themeColors.primary },
                  ]}>
                  <Text style={[styles.horizonChipText, { color: newCategory === c.id ? themeColors.primary : themeColors.text }]}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Account picker list */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Banco / Cuenta de pago *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.formHorizonList}>
              {accounts.map(a => (
                <Pressable
                  key={a.id}
                  onPress={() => setNewAccount(a.id)}
                  style={[
                    styles.horizonChip,
                    newAccount === a.id && { backgroundColor: themeColors.primary + '33', borderColor: themeColors.primary },
                  ]}>
                  <Text style={[styles.horizonChipText, { color: newAccount === a.id ? themeColors.primary : themeColors.text }]}>
                    {a.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Notes input */}
            <Text style={[styles.formLabel, { color: themeColors.muted }]}>Notas o Comentarios</Text>
            <TextInput
              placeholder="Notas adicionales..."
              placeholderTextColor={themeColors.muted}
              value={newNotes}
              onChangeText={setNewNotes}
              multiline
              style={[styles.formInputLarge, { color: themeColors.text, borderColor: themeColors.border }]}
            />

            {/* Save Button */}
            <Pressable
              onPress={onSave}
              style={[styles.saveBtn, { backgroundColor: themeColors.primary }]}>
              <Text style={styles.saveBtnText}>Guardar Movimiento</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 4, 8, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  glassModalLarge: {
    borderRadius: 28,
    borderWidth: 1,
    height: '80%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {
      height: 8,
      width: 0,
    },
    shadowOpacity: 0.44,
    shadowRadius: 10.32,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  modalCloseIcon: {
    fontSize: 16,
    fontWeight: 'bold',
    padding: 4,
  },
  formContainer: {
    gap: 16,
    paddingBottom: 40,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  formDropdownTrigger: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  chevronDown: {
    fontWeight: 'bold',
  },
  formToggle: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleBtn: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flex: 1,
    paddingVertical: 12,
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  formInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    height: 48,
    paddingHorizontal: 16,
  },
  formInputLarge: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 80,
    paddingHorizontal: 16,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  formHorizonList: {
    flexDirection: 'row',
    marginTop: 4,
  },
  horizonChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  horizonChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  saveBtn: {
    alignItems: 'center',
    borderRadius: 14,
    height: 50,
    justifyContent: 'center',
    marginTop: 14,
  },
  saveBtnText: {
    color: '#001d93',
    fontSize: 14,
    fontWeight: '800',
  },
});

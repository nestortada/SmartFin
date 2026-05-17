import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Transaction } from '../../types';

// ==========================================
// 1. MonthPickerModal
// ==========================================
type MonthPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  months: string[];
  selectedMonth: string;
  onSelectMonth: (m: string) => void;
  formatYearMonth: (m: string) => string;
};

export const MonthPickerModal: React.FC<MonthPickerModalProps> = ({
  visible,
  onClose,
  isDark,
  themeColors,
  months,
  selectedMonth,
  onSelectMonth,
  formatYearMonth,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.glassModal, { backgroundColor: isDark ? '#1a1824' : '#fff', borderColor: themeColors.border }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Selecciona un Mes</Text>
          <ScrollView style={styles.modalScroll}>
            <Pressable
              onPress={() => {
                onSelectMonth('all');
                onClose();
              }}
              style={styles.modalOption}>
              <Text style={[styles.modalOptionText, selectedMonth === 'all' && styles.modalOptionActive, { color: themeColors.text }]}>
                Todos los Meses
              </Text>
            </Pressable>
            {months.map(m => (
              <Pressable
                key={m}
                onPress={() => {
                  onSelectMonth(m);
                  onClose();
                }}
                style={styles.modalOption}>
                <Text style={[styles.modalOptionText, selectedMonth === m && styles.modalOptionActive, { color: themeColors.text }]}>
                  {formatYearMonth(m)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
};

// ==========================================
// 2. AccountPickerModal
// ==========================================
type AccountPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  accounts: any[];
  selectedAccount: string;
  onSelectAccount: (accId: string) => void;
};

export const AccountPickerModal: React.FC<AccountPickerModalProps> = ({
  visible,
  onClose,
  isDark,
  themeColors,
  accounts,
  selectedAccount,
  onSelectAccount,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.glassModal, { backgroundColor: isDark ? '#1a1824' : '#fff', borderColor: themeColors.border }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Selecciona un Banco / Cuenta</Text>
          <ScrollView style={styles.modalScroll}>
            <Pressable
              onPress={() => {
                onSelectAccount('all');
                onClose();
              }}
              style={styles.modalOption}>
              <Text style={[styles.modalOptionText, selectedAccount === 'all' && styles.modalOptionActive, { color: themeColors.text }]}>
                Todos los Bancos
              </Text>
            </Pressable>
            {accounts.map(a => (
              <Pressable
                key={a.id}
                onPress={() => {
                  onSelectAccount(a.id);
                  onClose();
                }}
                style={styles.modalOption}>
                <Text style={[styles.modalOptionText, selectedAccount === a.id && styles.modalOptionActive, { color: themeColors.text }]}>
                  {a.name} ({a.institutionName || 'Banco'})
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
};

// ==========================================
// 3. CategoryPickerModal
// ==========================================
type CategoryPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  categories: any[];
  selectedCategory: string;
  onSelectCategory: (catId: string) => void;
};

export const CategoryPickerModal: React.FC<CategoryPickerModalProps> = ({
  visible,
  onClose,
  isDark,
  themeColors,
  categories,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.glassModal, { backgroundColor: isDark ? '#1a1824' : '#fff', borderColor: themeColors.border }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Selecciona una Categoría</Text>
          <ScrollView style={styles.modalScroll}>
            <Pressable
              onPress={() => {
                onSelectCategory('all');
                onClose();
              }}
              style={styles.modalOption}>
              <Text style={[styles.modalOptionText, selectedCategory === 'all' && styles.modalOptionActive, { color: themeColors.text }]}>
                Todas las Categorías
              </Text>
            </Pressable>
            {categories.map(c => (
              <Pressable
                key={c.id}
                onPress={() => {
                  onSelectCategory(c.id);
                  onClose();
                }}
                style={styles.modalOption}>
                <Text style={[styles.modalOptionText, selectedCategory === c.id && styles.modalOptionActive, { color: themeColors.text }]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
};

// ==========================================
// 4. OpTypePickerModal
// ==========================================
type OpTypePickerModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  newOperationType: 'Débito' | 'Crédito';
  onSelectOpType: (op: 'Débito' | 'Crédito') => void;
};

export const OpTypePickerModal: React.FC<OpTypePickerModalProps> = ({
  visible,
  onClose,
  isDark,
  themeColors,
  newOperationType,
  onSelectOpType,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.glassModal, { backgroundColor: isDark ? '#161420' : '#fff', borderColor: themeColors.border }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text, marginBottom: 12 }]}>Selecciona Tipo de Operación</Text>
          <Pressable
            onPress={() => {
              onSelectOpType('Débito');
              onClose();
            }}
            style={styles.modalOption}>
            <Text style={[styles.modalOptionText, newOperationType === 'Débito' && styles.modalOptionActive, { color: themeColors.text }]}>
              💳 Débito
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onSelectOpType('Crédito');
              onClose();
            }}
            style={styles.modalOption}>
            <Text style={[styles.modalOptionText, newOperationType === 'Crédito' && styles.modalOptionActive, { color: themeColors.text }]}>
              💳 Crédito
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

// ==========================================
// 5. InlineOpTypeModal
// ==========================================
type InlineOpTypeModalProps = {
  tx: Transaction | null;
  onClose: () => void;
  isDark: boolean;
  themeColors: any;
  onSelectOpType: (tx: Transaction, op: 'Débito' | 'Crédito') => void;
};

export const InlineOpTypeModal: React.FC<InlineOpTypeModalProps> = ({
  tx,
  onClose,
  isDark,
  themeColors,
  onSelectOpType,
}) => {
  if (!tx) return null;

  const getOperationType = (transaction: Transaction) => {
    if (transaction.notes && transaction.notes.startsWith('Crédito •')) return 'Créd';
    return 'Deb';
  };

  return (
    <Modal visible={tx !== null} transparent animationType="fade">
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.glassModal, { backgroundColor: isDark ? '#161420' : '#fff', borderColor: themeColors.border }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text, marginBottom: 12 }]}>Tipo de Operación</Text>
          
          <Pressable
            onPress={() => {
              onSelectOpType(tx, 'Débito');
              onClose();
            }}
            style={styles.modalOption}>
            <Text style={[
              styles.modalOptionText, 
              getOperationType(tx) === 'Deb' && styles.modalOptionActive, 
              { color: themeColors.text }
            ]}>
              💳 Débito
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              onSelectOpType(tx, 'Crédito');
              onClose();
            }}
            style={styles.modalOption}>
            <Text style={[
              styles.modalOptionText, 
              getOperationType(tx) === 'Créd' && styles.modalOptionActive, 
              { color: themeColors.text }
            ]}>
              💳 Crédito
            </Text>
          </Pressable>
        </View>
      </Pressable>
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
  glassModal: {
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '60%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      height: 8,
      width: 0,
    },
    shadowOpacity: 0.44,
    shadowRadius: 10.32,
    width: '85%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalScroll: {
    maxHeight: 250,
  },
  modalOption: {
    borderRadius: 12,
    marginVertical: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalOptionActive: {
    color: '#00e475',
  },
});

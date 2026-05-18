import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { AppTheme } from '../../settings';
import { BottomNavigation, type BottomNavigationTab } from '../../../shared/components';
import { useTransactionsList, formatYearMonth } from '../hooks/useTransactionsList';
import type { Transaction, TransactionType } from '../types';
import { createSqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteCategoryRepository } from '../../categories/repositories/sqliteCategoryRepository';

import { TransactionCard } from './components/TransactionCard';
import { AddTransactionModal } from './components/AddTransactionModal';
import { CategorizationModal } from './components/CategorizationModal';
import {
  MonthPickerModal,
  AccountPickerModal,
  CategoryPickerModal,
  OpTypePickerModal,
  InlineOpTypeModal,
} from './components/FilterModals';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TransactionsScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  refreshKey?: number;
  onNavigateToHome: () => void;
  onOpenCreditCards: () => void;
  onOpenSettings: () => void;
  onForceRefresh: () => void;
};

export function TransactionsScreen({
  activeTheme,
  database,
  refreshKey = 0,
  onNavigateToHome,
  onOpenCreditCards,
  onOpenSettings,
  onForceRefresh,
}: TransactionsScreenProps) {
  const insets = useSafeAreaInsets();
  const isDark = activeTheme === 'dark';

  // State for picker modals
  const [monthModalVisible, setMonthModalVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [addTxModalVisible, setAddTxModalVisible] = useState(false);

  // Form states for adding manual transaction
  const [newAmount, setNewAmount] = useState('');
  const [newMerchant, setNewMerchant] = useState('');
  const [newType, setNewType] = useState<TransactionType>('expense');
  const [newCategory, setNewCategory] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newOperationType, setNewOperationType] = useState<'Débito' | 'Crédito'>('Débito');
  const [opTypePickerVisible, setOpTypePickerVisible] = useState(false);
  const [selectedTxForOpType, setSelectedTxForOpType] = useState<Transaction | null>(null);

  // Categorization Modal States
  const [categorizationModalVisible, setCategorizationModalVisible] = useState(false);
  const [selectedTxForCategorization, setSelectedTxForCategorization] = useState<Transaction | null>(null);

  // Fetch live hook data
  const {
    filteredTransactions,
    accounts,
    categories,
    months,
    loading,
    error,
    selectedMonth,
    setSelectedMonth,
    selectedAccount,
    setSelectedAccount,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
  } = useTransactionsList(database, refreshKey);

  // Dynamic values
  const themeColors = {
    background: isDark ? '#0d0b14' : '#f4f3f8',
    text: isDark ? '#f1f0ff' : '#19191d',
    muted: isDark ? '#c5c5d9' : '#686678',
    border: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(35, 42, 65, 0.12)',
    card: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.72)',
    primary: isDark ? '#bbc3ff' : '#2848ee',
    tertiary: '#00e475', // Neon green
    danger: isDark ? '#ffb4ab' : '#ba1a1a',
    glassBorder: 'rgba(255, 255, 255, 0.12)',
  };

  // Helper: map macro categories to symbols/icons
  const getCategoryIcon = (macro: string): string => {
    switch (macro) {
      case 'income':
        return '💵';
      case 'food':
        return '🍔';
      case 'transport':
        return '🚗';
      case 'housing':
        return '🏠';
      case 'entertainment':
        return '🍿';
      case 'health':
        return '💊';
      case 'utilities':
        return '💡';
      case 'debts':
        return '💳';
      case 'investments':
        return '📈';
      default:
        return '📦';
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

  const getOperationType = (tx: Transaction) => {
    if (tx.notes && tx.notes.startsWith('Crédito •')) return 'Créd';
    return 'Deb'; // Default to Débito if not explicitly Crédito
  };

  const handleUpdateTransactionOpType = async (tx: Transaction, opType: 'Débito' | 'Crédito') => {
    if (!database) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      // Clean notes to avoid compounding prefixes
      let cleanNotes = tx.notes || '';
      // Remove any existing "Débito • " or "Crédito • " prefix
      cleanNotes = cleanNotes.replace(/^(Débito|Crédito)\s*•\s*/, '');
      
      const updatedTx: Transaction = {
        ...tx,
        notes: `${opType} • ${cleanNotes}`,
        updatedAt: new Date().toISOString(),
      };
      await txRepo.saveTransactions([updatedTx]);
      onForceRefresh(); // reload database to reflect updates
    } catch (err) {
      console.error('Error updating transaction operation type:', err);
    }
  };

  const showOpTypeDropdown = (tx: Transaction) => {
    setSelectedTxForOpType(tx);
  };

  const handleCardPress = (tx: Transaction) => {
    // Only open categorization modal for purchases / expenses / gastos
    if (tx.direction === 'outflow' || tx.type === 'expense') {
      setSelectedTxForCategorization(tx);
      setCategorizationModalVisible(true);
    }
  };

  const handleSelectCategory = async (categoryId: string, applyToFuture: boolean) => {
    if (!database || !selectedTxForCategorization) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      const merchantName = selectedTxForCategorization.merchantName || selectedTxForCategorization.description;
      
      if (applyToFuture) {
        // Save the automatic rule in sqlite
        await txRepo.saveMerchantMapping(merchantName, categoryId);
        // Batch update all current transactions matching description/merchantName
        await txRepo.updateTransactionsCategoryByDescription(merchantName, categoryId);
      } else {
        // Update only this single transaction category
        await txRepo.updateTransactionCategory(selectedTxForCategorization.id, categoryId);
      }
      
      onForceRefresh(); // Trigger parent refresh
    } catch (err) {
      console.error('Error selecting category:', err);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!database) return;
    try {
      const txRepo = createSqliteTransactionRepository(database);
      await txRepo.deleteTransaction(id);
      onForceRefresh(); // Trigger parent refresh
    } catch (err) {
      console.error('Error deleting transaction:', err);
    }
  };

  const handleCreateCategory = async (name: string, color: string) => {
    if (!database) return null;
    try {
      const catRepo = createSqliteCategoryRepository(database);
      const newCat = {
        id: 'category-custom-' + Date.now(),
        name,
        type: 'expense' as const,
        macroCategory: 'other' as const,
        color,
      };
      await catRepo.saveCategories([newCat]);
      onForceRefresh(); // Refresh parent database context
      return newCat;
    } catch (err) {
      console.error('Error creating category:', err);
      return null;
    }
  };

  // Sum available balance
  const totalBalance = accounts
    .filter(a => a.status === 'active' && ['cash', 'bankAccount', 'savingsAccount'].includes(a.type))
    .reduce((sum, a) => sum + a.balance.amount, 0);

  // Group transactions by date
  const groupTransactionsByDate = () => {
    const groups: { [key: string]: Transaction[] } = {};
    filteredTransactions.forEach(tx => {
      const dateStr = tx.date.slice(0, 10);
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(tx);
    });
    return Object.keys(groups).map(date => ({
      date,
      data: groups[date] || [],
    }));
  };

  const formattedDateHeader = (dateStr: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (dateStr === today) return 'HOY';
    if (dateStr === yesterday) return 'AYER';

    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const [year, month, day] = parts;
    const monthsSpanish = [
      'ENE',
      'FEB',
      'MAR',
      'ABR',
      'MAY',
      'JUN',
      'JUL',
      'AGO',
      'SEP',
      'OCT',
      'NOV',
      'DIC',
    ];
    const monthIndex = parseInt(month as string, 10) - 1;
    return `${day} DE ${monthsSpanish[monthIndex]} DE ${year}`;
  };

  // Format currency
  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(val);
  };

  // Handle Bottom Nav switching
  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'home') {
      onNavigateToHome();
    } else if (tab === 'more') {
      onOpenSettings();
    }
  };

  // Save manual transaction to SQLite
  const handleSaveTransaction = async () => {
    if (!database || !newAmount || !newMerchant || !newAccount) {
      Alert.alert('Error', 'Por favor, llena los campos obligatorios.');
      return;
    }

    try {
      const cleanAmount = parseFloat(newAmount.replace(/[^0-9.]/g, ''));
      if (isNaN(cleanAmount)) {
        Alert.alert('Error', 'Monto inválido.');
        return;
      }

      const txRepo = createSqliteTransactionRepository(database);
      const isIncome = newType === 'income';

      const transactionNotes = newNotes 
        ? `${newOperationType} • ${newNotes}` 
        : `${newOperationType} • Registro manual`;

      const newTx: Transaction = {
        id: 'tx_manual_' + Date.now(),
        amount: cleanAmount,
        currency: 'COP',
        description: newMerchant,
        date: new Date().toISOString(),
        accountId: newAccount,
        categoryId: newCategory || undefined,
        type: newType,
        direction: isIncome ? 'inflow' : 'outflow',
        status: 'posted',
        merchantName: newMerchant,
        notes: transactionNotes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Also adjust account balance in SQLite
      const accRepo = createSqliteAccountRepository(database);
      const matchedAcc = accounts.find(a => a.id === newAccount);
      if (matchedAcc) {
        const updatedBalance = isIncome
          ? matchedAcc.balance.amount + cleanAmount
          : matchedAcc.balance.amount - cleanAmount;

        await accRepo.saveAccounts([
          {
            ...matchedAcc,
            balance: {
              ...matchedAcc.balance,
              amount: updatedBalance,
            },
            updatedAt: new Date().toISOString(),
          },
        ]);
      }

      await txRepo.saveTransactions([newTx]);
      setAddTxModalVisible(false);
      onForceRefresh(); // Trigger parent database reload!

      // Reset form fields
      setNewAmount('');
      setNewMerchant('');
      setNewCategory('');
      setNewAccount('');
      setNewNotes('');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Error guardando la transacción.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: themeColors.background }]}>
      {/* Dynamic Background Glowing Circles (Apple Liquid Glass blurs) */}
      {isDark && (
        <View style={styles.glowContainer} pointerEvents="none">
          <View style={styles.purpleGlow} />
          <View style={styles.greenGlow} />
        </View>
      )}

      {/* Header bar */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarContainer, { borderColor: themeColors.glassBorder }]}>
            <Text style={styles.avatarText}>SF</Text>
          </View>
          <Text style={[styles.headerTitle, { color: themeColors.text }]}>SmartFin</Text>
        </View>
        <Pressable
          style={[styles.bellButton, { borderColor: themeColors.glassBorder }]}
          android_ripple={{ color: 'rgba(255,255,255,0.1)' }}>
          <Text style={styles.bellIcon}>🔔</Text>
          <View style={styles.bellIndicator} />
        </Pressable>
      </View>

      {/* Balance and active route summary */}
      <View style={styles.activitySummary}>
        <View>
          <Text style={[styles.activityLabel, { color: themeColors.muted }]}>Actividad Reciente</Text>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Movimientos</Text>
        </View>
        <View style={styles.balanceContainer}>
          <Text style={styles.balanceValue}>{formatCOP(totalBalance)}</Text>
          <Text style={[styles.balanceLabel, { color: themeColors.tertiary }]}>SALDO DISPONIBLE</Text>
        </View>
      </View>

      {/* Filter Horizontal Scroll */}
      <View style={styles.filtersContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersScrollContent}>
          
          {/* Month selector */}
          <Pressable
            onPress={() => setMonthModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>📅</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedMonth === 'all' ? 'Todos los Meses' : formatYearMonth(selectedMonth)}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Account selector */}
          <Pressable
            onPress={() => setAccountModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>🏦</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedAccount === 'all'
                ? 'Todos los Bancos'
                : accounts.find(a => a.id === selectedAccount)?.name || 'Banco'}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Category selector */}
          <Pressable
            onPress={() => setCategoryModalVisible(true)}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>🏷️</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {selectedCategory === 'all'
                ? 'Todas las Categorías'
                : categories.find(c => c.id === selectedCategory)?.name || 'Categoría'}
            </Text>
            <Text style={[styles.chevronDown, { color: themeColors.muted }]}>▾</Text>
          </Pressable>

          {/* Sort order switcher */}
          <Pressable
            onPress={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
            style={[styles.filterChip, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <Text style={styles.filterChipIcon}>⇅</Text>
            <Text style={[styles.filterChipText, { color: themeColors.text }]}>
              {sortOrder === 'newest' ? 'Recientes Primero' : 'Antiguos Primero'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Frosted Glass Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="Buscar por comercio, notas..."
            placeholderTextColor={themeColors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchInput, { color: themeColors.text }]}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Text style={[styles.clearIcon, { color: themeColors.muted }]}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Main Transactions List grouped by dates */}
      <FlatList
        data={groupTransactionsByDate()}
        keyExtractor={item => item.date}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No se encontraron movimientos</Text>
            <Text style={[styles.emptySubtitle, { color: themeColors.muted }]}>
              Intenta quitando algunos filtros o realiza un registro manual.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.dateGroup}>
            <Text style={[styles.dateHeader, { color: themeColors.muted }]}>
              {formattedDateHeader(item.date)}
            </Text>

            {item.data.map(tx => (
              <TransactionCard
                key={tx.id}
                tx={tx}
                isDark={isDark}
                themeColors={themeColors}
                categories={categories}
                accounts={accounts}
                onShowOpTypeDropdown={showOpTypeDropdown}
                onPress={handleCardPress}
              />
            ))}
          </View>
        )}
      />

      {/* Floating Action Button (FAB) */}
      <Pressable
        onPress={() => {
          // prefill default category/account if available
          if (categories.length > 0 && categories[0]) setNewCategory(categories[0].id);
          if (accounts.length > 0 && accounts[0]) setNewAccount(accounts[0].id);
          setAddTxModalVisible(true);
        }}
        style={[styles.fabButton, { backgroundColor: themeColors.primary }]}>
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {/* MODALs: Filtering and manual creation */}
      <MonthPickerModal
        visible={monthModalVisible}
        onClose={() => setMonthModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        months={months}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
        formatYearMonth={formatYearMonth}
      />

      <AccountPickerModal
        visible={accountModalVisible}
        onClose={() => setAccountModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        accounts={accounts}
        selectedAccount={selectedAccount}
        onSelectAccount={setSelectedAccount}
      />

      <CategoryPickerModal
        visible={categoryModalVisible}
        onClose={() => setCategoryModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      <AddTransactionModal
        visible={addTxModalVisible}
        onClose={() => setAddTxModalVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        accounts={accounts}
        newAmount={newAmount}
        setNewAmount={setNewAmount}
        newMerchant={newMerchant}
        setNewMerchant={setNewMerchant}
        newType={newType}
        setNewType={setNewType}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        newAccount={newAccount}
        setNewAccount={setNewAccount}
        newNotes={newNotes}
        setNewNotes={setNewNotes}
        newOperationType={newOperationType}
        setNewOperationType={setNewOperationType}
        opTypePickerVisible={opTypePickerVisible}
        setOpTypePickerVisible={setOpTypePickerVisible}
        onSave={handleSaveTransaction}
      />

      <OpTypePickerModal
        visible={opTypePickerVisible}
        onClose={() => setOpTypePickerVisible(false)}
        isDark={isDark}
        themeColors={themeColors}
        newOperationType={newOperationType}
        onSelectOpType={setNewOperationType}
      />

      <InlineOpTypeModal
        tx={selectedTxForOpType}
        onClose={() => setSelectedTxForOpType(null)}
        isDark={isDark}
        themeColors={themeColors}
        onSelectOpType={handleUpdateTransactionOpType}
      />

      <CategorizationModal
        visible={categorizationModalVisible}
        onClose={() => setCategorizationModalVisible(false)}
        tx={selectedTxForCategorization}
        isDark={isDark}
        themeColors={themeColors}
        categories={categories}
        onSelectCategory={handleSelectCategory}
        onDeleteTransaction={handleDeleteTransaction}
        onCreateCategory={handleCreateCategory}
      />

      {/* Shared Bottom Tab Navigation bar */}
      <BottomNavigation
        activeTab="transactions"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  accText: {
    fontSize: 12,
    fontWeight: '500',
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  activitySummary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatarContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: {
    color: '#bbc3ff',
    fontSize: 13,
    fontWeight: '800',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  balanceValue: {
    color: '#00e475',
    fontSize: 20,
    fontWeight: '800',
  },
  bellButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  bellIcon: {
    fontSize: 16,
  },
  bellIndicator: {
    backgroundColor: '#00e475',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 9,
    top: 9,
    width: 8,
  },
  catBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  catBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  catEmoji: {
    fontSize: 16,
  },
  catIconContainer: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  chevronDown: {
    fontSize: 11,
    marginLeft: 3,
  },
  clearIcon: {
    fontSize: 14,
    padding: 6,
  },
  dateGroup: {
    gap: 12,
    marginBottom: 20,
  },
  dateHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  fabButton: {
    alignItems: 'center',
    borderRadius: 28,
    bottom: 104,
    elevation: 8,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: 22,
    shadowColor: '#000',
    shadowOffset: {
      height: 4,
      width: 0,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    width: 56,
    zIndex: 99,
  },
  fabIcon: {
    color: '#001d93',
    fontSize: 28,
    fontWeight: '600',
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 36,
    paddingHorizontal: 12,
  },
  filterChipIcon: {
    fontSize: 13,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filtersContainer: {
    height: 46,
    paddingHorizontal: 14,
  },
  filtersScrollContent: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 24,
  },
  formContainer: {
    gap: 16,
    paddingBottom: 32,
  },
  formHorizonList: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  formInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    height: 48,
    paddingHorizontal: 14,
  },
  formInputLarge: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    height: 80,
    paddingHorizontal: 14,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  formDropdownTrigger: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  formToggle: {
    flexDirection: 'row',
    gap: 10,
  },
  glassModal: {
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '60%',
    padding: 20,
    width: SCREEN_WIDTH * 0.85,
  },
  glassModalLarge: {
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: '90%',
    padding: 22,
    width: SCREEN_WIDTH * 0.9,
  },
  glowContainer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  greenGlow: {
    backgroundColor: 'rgba(0, 228, 117, 0.10)',
    borderRadius: 180,
    height: 360,
    position: 'absolute',
    right: -100,
    top: 250,
    width: 360,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
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
  listContent: {
    gap: 18,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  purpleGlow: {
    backgroundColor: 'rgba(205, 189, 255, 0.12)',
    borderRadius: 200,
    height: 400,
    left: -120,
    position: 'absolute',
    top: -50,
    width: 400,
  },
  screen: {
    flex: 1,
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: 12,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    height: '100%',
    padding: 0,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
});

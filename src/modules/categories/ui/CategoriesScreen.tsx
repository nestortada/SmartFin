import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { AppTheme } from '../../settings';
import type { Category } from '../types';
import { createSqliteCategoryRepository } from '../repositories/sqliteCategoryRepository';
import {
  createCategory,
  deleteCategory,
  FALLBACK_CATEGORY_ID,
  listManageableCategories,
  updateCategory,
  type ManageableCategoryType,
} from '../useCases';

type CategoriesScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onNavigateBack: () => void;
  onNavigateToHome: () => void;
  onNavigateToTransactions: () => void;
  onOpenCreditCards: () => void;
  onOpenDebitCards: () => void;
  onOpenSettings: () => void;
};

type CategoryFormState = {
  color: string;
  name: string;
  type: ManageableCategoryType;
};

type CategoryPalette = {
  background: string;
  border: string;
  card: string;
  cardStrong: string;
  danger: string;
  dangerSoft: string;
  inverseText: string;
  muted: string;
  primary: string;
  primarySoft: string;
  secondary: string;
  surface: string;
  tertiary: string;
  text: string;
};

const colorPresets = ['#bbc3ff', '#cdbdff', '#00e475', '#ffb4ab', '#8fd8ff', '#c5c5d9'];

const emptyExpenseForm: CategoryFormState = {
  color: '#bbc3ff',
  name: '',
  type: 'expense',
};

const palettes: Record<AppTheme, CategoryPalette> = {
  dark: {
    background: '#0a0a0b',
    border: 'rgba(255, 255, 255, 0.12)',
    card: 'rgba(255, 255, 255, 0.06)',
    cardStrong: 'rgba(255, 255, 255, 0.09)',
    danger: '#ffb4ab',
    dangerSoft: 'rgba(255, 180, 171, 0.12)',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    primarySoft: 'rgba(187, 195, 255, 0.16)',
    secondary: '#cdbdff',
    surface: '#201f20',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(30, 36, 60, 0.12)',
    card: 'rgba(255, 255, 255, 0.74)',
    cardStrong: 'rgba(255, 255, 255, 0.94)',
    danger: '#a9362e',
    dangerSoft: 'rgba(169, 54, 46, 0.1)',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    primarySoft: 'rgba(61, 90, 254, 0.12)',
    secondary: '#5203d5',
    surface: '#ffffff',
    tertiary: '#007f3e',
    text: '#18191f',
  },
};

function getCategoryInitials(category: Category): string {
  if (category.macroCategory === 'income') {
    return '$';
  }

  return category.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'CT';
}

function getCategorySubtitle(category: Category): string {
  const labels: Record<string, string> = {
    entertainment: 'Ocio',
    food: 'Alimentacion',
    health: 'Bienestar',
    housing: 'Vivienda',
    income: 'Ingreso',
    other: 'General',
    transport: 'Movilidad',
    utilities: 'Servicios',
  };

  return labels[category.macroCategory] ?? 'Categoria';
}

export function CategoriesScreen({
  activeTheme,
  database,
  onNavigateBack,
  onNavigateToHome,
  onNavigateToTransactions,
  onOpenCreditCards,
  onOpenDebitCards,
  onOpenSettings,
}: CategoriesScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = palettes[activeTheme];
  const repository = useMemo(
    () => database ? createSqliteCategoryRepository(database) : undefined,
    [database],
  );
  const [activeType, setActiveType] = useState<ManageableCategoryType>('expense');
  const [busyMessage, setBusyMessage] = useState<string>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingCategory, setEditingCategory] = useState<Category>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [formState, setFormState] = useState<CategoryFormState>(emptyExpenseForm);
  const [formVisible, setFormVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const visibleCategories = useMemo(
    () => categories.filter(category => category.type === activeType),
    [activeType, categories],
  );

  const loadCategories = useCallback(async () => {
    if (!repository) {
      setLoading(false);
      setErrorMessage('La base de datos local aun no esta lista.');
      return;
    }

    setLoading(true);
    setErrorMessage(undefined);

    try {
      setCategories(await listManageableCategories(repository));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar las categorias.',
      );
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const runCategoryTask = async (message: string, task: () => Promise<void>) => {
    if (!repository) {
      setErrorMessage('La base de datos local aun no esta lista.');
      return;
    }

    setBusyMessage(message);
    setErrorMessage(undefined);

    try {
      await task();
      await loadCategories();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo completar la accion.',
      );
    } finally {
      setBusyMessage(undefined);
    }
  };

  const openCreateForm = () => {
    setEditingCategory(undefined);
    setFormState({
      ...emptyExpenseForm,
      color: activeType === 'income' ? '#00e475' : '#bbc3ff',
      type: activeType,
    });
    setFormVisible(true);
  };

  const openEditForm = (category: Category) => {
    setEditingCategory(category);
    setFormState({
      color: category.color,
      name: category.name,
      type: category.type as ManageableCategoryType,
    });
    setFormVisible(true);
  };

  const saveForm = () => {
    void runCategoryTask(
      editingCategory ? 'Actualizando categoria...' : 'Creando categoria...',
      async () => {
        if (!repository) {
          return;
        }

        if (editingCategory) {
          await updateCategory(repository, editingCategory.id, formState);
        } else {
          await createCategory(repository, formState);
        }

        setFormVisible(false);
      },
    );
  };

  const confirmDeleteCategory = (category: Category) => {
    if (category.id === FALLBACK_CATEGORY_ID) {
      Alert.alert('Categoria protegida', 'Otros recibe los movimientos de categorias eliminadas.');
      return;
    }

    Alert.alert(
      'Eliminar categoria',
      `Los movimientos de "${category.name}" pasaran a Otros.`,
      [
        { style: 'cancel', text: 'Cancelar' },
        {
          onPress: () => {
            void runCategoryTask('Eliminando categoria...', async () => {
              if (repository) {
                await deleteCategory(repository, category.id);
              }
            });
          },
          style: 'destructive',
          text: 'Eliminar',
        },
      ],
    );
  };

  const handleTabPress = (tab: BottomNavigationTab) => {
    if (tab === 'home') {
      onNavigateToHome();
    } else if (tab === 'transactions') {
      onNavigateToTransactions();
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.topBar,
          {
            backgroundColor:
              activeTheme === 'dark'
                ? 'rgba(10, 10, 11, 0.92)'
                : 'rgba(248, 247, 251, 0.92)',
            borderColor: palette.border,
            paddingTop: insets.top + 8,
          },
        ]}>
        <Pressable accessibilityRole="button" onPress={onNavigateBack} style={styles.backButton}>
          <Text style={[styles.backIcon, { color: palette.primary }]}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.brandTitle, { color: palette.primary }]}>SmartFin</Text>
        <View style={styles.topActions}>
          <Text style={[styles.searchIcon, { color: palette.muted }]}>?</Text>
          <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
            <Text style={[styles.avatarText, { color: palette.inverseText }]}>SF</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 124, paddingTop: insets.top + 92 },
        ]}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: palette.text }]}>Administrar Categorias</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            Personaliza tus flujos financieros
          </Text>
        </View>

        <View style={[styles.segmentedWrap, { backgroundColor: palette.cardStrong, borderColor: palette.border }]}>
          <CategoryTypeButton
            isActive={activeType === 'expense'}
            label="Gastos"
            onPress={() => setActiveType('expense')}
            palette={palette}
          />
          <CategoryTypeButton
            isActive={activeType === 'income'}
            label="Ingresos"
            onPress={() => setActiveType('income')}
            palette={palette}
          />
        </View>

        {busyMessage ? (
          <StatusMessage palette={palette} text={busyMessage} tone="primary" />
        ) : null}

        {errorMessage ? (
          <StatusMessage palette={palette} text={errorMessage} tone="danger" />
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.primary} />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Cargando categorias...</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleCategories.map(category => (
              <CategoryRow
                category={category}
                key={category.id}
                onDelete={() => confirmDeleteCategory(category)}
                onEdit={() => openEditForm(category)}
                palette={palette}
              />
            ))}
            {visibleCategories.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>Sin categorias</Text>
                <Text style={[styles.emptyText, { color: palette.muted }]}>
                  Crea una categoria para este flujo.
                </Text>
              </View>
            ) : null}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={openCreateForm}
          style={[styles.addButton, { backgroundColor: palette.primary }]}>
          <Text style={[styles.addButtonText, { color: palette.inverseText }]}>
            + Añadir Nueva Categoria
          </Text>
        </Pressable>
      </ScrollView>

      <CategoryFormModal
        editing={Boolean(editingCategory)}
        formState={formState}
        onChange={setFormState}
        onClose={() => setFormVisible(false)}
        onSave={saveForm}
        palette={palette}
        visible={formVisible}
      />

      <BottomNavigation
        activeTab="more"
        bottomInset={insets.bottom}
        colorScheme={activeTheme}
        onMoreActionPress={action => {
          if (action === 'creditCards') {
            onOpenCreditCards();
          } else if (action === 'debitCards') {
            onOpenDebitCards();
          } else {
            onOpenSettings();
          }
        }}
        onTabPress={handleTabPress}
      />
    </View>
  );
}

function CategoryTypeButton({
  isActive,
  label,
  onPress,
  palette,
}: {
  isActive: boolean;
  label: string;
  onPress: () => void;
  palette: CategoryPalette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      style={[
        styles.segmentButton,
        isActive ? { backgroundColor: palette.primary } : null,
      ]}>
      <Text
        style={[
          styles.segmentButtonText,
          { color: isActive ? palette.inverseText : palette.muted },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryRow({
  category,
  onDelete,
  onEdit,
  palette,
}: {
  category: Category;
  onDelete: () => void;
  onEdit: () => void;
  palette: CategoryPalette;
}) {
  const isProtected = category.id === FALLBACK_CATEGORY_ID;

  return (
    <View style={[styles.categoryRow, { backgroundColor: palette.cardStrong, borderColor: palette.border }]}>
      <View style={[styles.categoryIcon, { backgroundColor: `${category.color}22`, borderColor: category.color }]}>
        <Text style={[styles.categoryIconText, { color: category.color }]}>
          {getCategoryInitials(category)}
        </Text>
      </View>
      <View style={styles.categoryCopy}>
        <Text style={[styles.categoryName, { color: palette.text }]}>{category.name}</Text>
        <Text style={[styles.categorySubtitle, { color: palette.muted }]}>
          {getCategorySubtitle(category)}
        </Text>
      </View>
      <Text style={[styles.dragHandle, { color: palette.muted }]}>=</Text>
      <Pressable accessibilityRole="button" onPress={onEdit} style={styles.rowAction}>
        <Text style={[styles.rowActionText, { color: palette.primary }]}>Editar</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isProtected}
        onPress={onDelete}
        style={[
          styles.rowAction,
          isProtected ? { opacity: 0.38 } : null,
        ]}>
        <Text style={[styles.rowActionText, { color: palette.danger }]}>
          {isProtected ? 'Base' : 'Eliminar'}
        </Text>
      </Pressable>
    </View>
  );
}

function CategoryFormModal({
  editing,
  formState,
  onChange,
  onClose,
  onSave,
  palette,
  visible,
}: {
  editing: boolean;
  formState: CategoryFormState;
  onChange: (state: CategoryFormState) => void;
  onClose: () => void;
  onSave: () => void;
  palette: CategoryPalette;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.modalTitle, { color: palette.text }]}>
            {editing ? 'Modificar categoria' : 'Nueva categoria'}
          </Text>
          <TextInput
            onChangeText={name => onChange({ ...formState, name })}
            placeholder="Nombre"
            placeholderTextColor={palette.muted}
            style={[styles.input, { borderColor: palette.border, color: palette.text }]}
            value={formState.name}
          />
          <View style={[styles.formSegmented, { borderColor: palette.border }]}>
            <CategoryTypeButton
              isActive={formState.type === 'expense'}
              label="Gasto"
              onPress={() => onChange({ ...formState, type: 'expense' })}
              palette={palette}
            />
            <CategoryTypeButton
              isActive={formState.type === 'income'}
              label="Ingreso"
              onPress={() => onChange({ ...formState, type: 'income' })}
              palette={palette}
            />
          </View>
          <View style={styles.swatches}>
            {colorPresets.map(color => (
              <Pressable
                accessibilityRole="button"
                key={color}
                onPress={() => onChange({ ...formState, color })}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: color,
                    borderColor: formState.color === color ? palette.text : 'transparent',
                  },
                ]}
              />
            ))}
          </View>
          <TextInput
            autoCapitalize="none"
            onChangeText={color => onChange({ ...formState, color })}
            placeholder="#bbc3ff"
            placeholderTextColor={palette.muted}
            style={[styles.input, { borderColor: palette.border, color: palette.text }]}
            value={formState.color}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={[styles.modalButton, { borderColor: palette.border }]}>
              <Text style={[styles.modalButtonText, { color: palette.muted }]}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={onSave} style={[styles.modalButton, { backgroundColor: palette.primary }]}>
              <Text style={[styles.modalButtonText, { color: palette.inverseText }]}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StatusMessage({
  palette,
  text,
  tone,
}: {
  palette: CategoryPalette;
  text: string;
  tone: 'danger' | 'primary';
}) {
  const color = tone === 'danger' ? palette.danger : palette.primary;

  return (
    <View
      style={[
        styles.statusMessage,
        {
          backgroundColor: tone === 'danger' ? palette.dangerSoft : palette.primarySoft,
          borderColor: color,
        },
      ]}>
      <Text style={[styles.statusText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: '#3d5afe',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '900',
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '900',
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 34,
  },
  backIcon: {
    fontSize: 22,
    fontWeight: '900',
  },
  brandTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '900',
  },
  categoryCopy: {
    flex: 1,
    gap: 2,
  },
  categoryIcon: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  categoryIconText: {
    fontSize: 12,
    fontWeight: '900',
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '900',
  },
  categoryRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  categorySubtitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  content: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  dragHandle: {
    fontSize: 18,
    fontWeight: '900',
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 18,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  formSegmented: {
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  heading: {
    gap: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    fontWeight: '700',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  list: {
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingWrap: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 34,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 13,
    fontWeight: '900',
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 18,
    width: '100%',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  rowAction: {
    alignItems: 'center',
    minHeight: 36,
    justifyContent: 'center',
    minWidth: 44,
  },
  rowActionText: {
    fontSize: 11,
    fontWeight: '900',
  },
  screen: {
    flex: 1,
  },
  searchIcon: {
    fontSize: 17,
    fontWeight: '900',
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    minHeight: 34,
    justifyContent: 'center',
  },
  segmentButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  segmentedWrap: {
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  statusMessage: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  swatch: {
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    width: 28,
  },
  swatches: {
    flexDirection: 'row',
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 34,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  topBar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
});

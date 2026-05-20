import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import type { Category } from '../../../categories/types';
import type { Transaction } from '../../types';

const GRID_GAP = 12;
const SHEET_HORIZONTAL_PADDING = 20;
const SHEET_MAX_WIDTH = 520;

type ThemeColors = {
  background: string;
  border: string;
  card: string;
  danger: string;
  glassBorder: string;
  muted: string;
  primary: string;
  tertiary: string;
  text: string;
};

type CategorizationModalProps = {
  visible: boolean;
  onClose: () => void;
  tx: Transaction | null;
  isDark: boolean;
  themeColors: ThemeColors;
  categories: Category[];
  onSelectCategory: (categoryId: string, applyToFuture: boolean) => Promise<void>;
  onDeleteTransaction: (id: string) => Promise<void>;
  onCreateCategory: (name: string, color: string) => Promise<Category | null>;
  onEditTransaction: (tx: Transaction) => void;
};

const paletteColors = [
  '#bbc3ff',
  '#cdbdff',
  '#8ea2ff',
  '#d7b7ff',
  '#ffb4ab',
  '#8fd8ff',
  '#62ff96',
  '#ffd062',
];

const quickCategorySpecs = [
  { key: 'education', macro: 'education', name: 'Universidad', icon: 'ED', color: '#bbc3ff' },
  { key: 'food', macro: 'food', name: 'Restaurantes', icon: 'FO', color: '#cdbdff' },
  { key: 'transport', macro: 'transport', name: 'Transporte', icon: 'TR', color: '#8ea2ff' },
  { key: 'shopping', macro: 'shopping', name: 'Compras', icon: 'CO', color: '#d7b7ff' },
  { key: 'entertainment', macro: 'entertainment', name: 'Entretenimiento', icon: 'EN', color: '#ffb4ab' },
];

export function CategorizationModal({
  visible,
  onClose,
  tx,
  isDark,
  themeColors,
  categories,
  onSelectCategory,
  onDeleteTransaction,
  onCreateCategory,
  onEditTransaction,
}: CategorizationModalProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [applyToFuture, setApplyToFuture] = useState(true);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>();
  const [newCatName, setNewCatName] = useState('');
  const [selectedColor, setSelectedColor] = useState(paletteColors[0] ?? '#cdbdff');

  useEffect(() => {
    if (visible) {
      setApplyToFuture(true);
      setShowAllCategories(false);
      setNewCatName('');
      setSelectedColor(paletteColors[0] ?? '#cdbdff');
      setSelectedCategoryId(tx?.categoryId);
    }
  }, [tx?.categoryId, visible]);

  const quickCategories = useMemo(() => {
    return quickCategorySpecs.map(spec => {
      const dbCategory =
        categories.find(category => category.name.toLowerCase().includes(spec.name.toLowerCase())) ??
        categories.find(category => category.macroCategory === spec.macro) ??
        categories.find(category => {
          if (spec.macro === 'shopping') {
            return ['other', 'utilities'].includes(category.macroCategory);
          }
          if (spec.macro === 'education') {
            return category.macroCategory === 'other';
          }
          return false;
        });

      return {
        id: dbCategory?.id ?? spec.name,
        key: spec.key,
        color: dbCategory?.color ?? spec.color,
        icon: spec.icon,
        name: dbCategory?.name ?? spec.name,
      };
    });
  }, [categories]);

  if (!tx) {
    return null;
  }

  const selectedCategory = categories.find(category => category.id === selectedCategoryId);
  const merchantName = tx.merchantName || tx.description;
  const isIncome = tx.direction === 'inflow' || tx.type === 'income';
  const sheetWidth = Math.min(windowWidth, SHEET_MAX_WIDTH);
  const contentWidth = Math.max(sheetWidth - SHEET_HORIZONTAL_PADDING * 2, 0);
  const categoryTileWidth = Math.floor((contentWidth - GRID_GAP) / 2);

  const formatDate = (dateStr: string) => {
    const parts = dateStr.slice(0, 10).split('-');
    if (parts.length !== 3) {
      return dateStr;
    }

    const [year, month, day] = parts;
    const monthsSpanish = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const monthName = monthsSpanish[Number(month) - 1] ?? 'Enero';
    return `${Number(day)} de ${monthName} de ${year}`;
  };

  const formatCOP = (val: number) =>
    new Intl.NumberFormat('es-CO', {
      currency: 'COP',
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(val);

  const confirmCategory = async () => {
    if (!selectedCategoryId) {
      Alert.alert('SmartFin', 'Selecciona una categoria para continuar.');
      return;
    }
    if (!categories.some(category => category.id === selectedCategoryId)) {
      setShowAllCategories(true);
      Alert.alert('SmartFin', 'Selecciona una categoria existente o crea una nueva.');
      return;
    }

    await onSelectCategory(selectedCategoryId, applyToFuture);
    onClose();
  };

  const handleCreateAndSelectCategory = async () => {
    const categoryName = newCatName.trim();
    if (!categoryName) {
      Alert.alert('SmartFin', 'Ingresa un nombre para la categoria.');
      return;
    }

    const newCategory = await onCreateCategory(categoryName, selectedColor);
    if (newCategory) {
      setSelectedCategoryId(newCategory.id);
      setShowAllCategories(false);
      setNewCatName('');
    }
  };

  const handleDeletePress = () => {
    Alert.alert(
      'Eliminar transaccion',
      'Esta accion eliminara el registro local y no se podra deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          onPress: async () => {
            await onDeleteTransaction(tx.id);
            onClose();
          },
          style: 'destructive',
          text: 'Eliminar',
        },
      ],
    );
  };

  const handleEditPress = () => {
    onClose();
    onEditTransaction(tx);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? '#131314' : themeColors.background,
              borderColor: themeColors.border,
              maxWidth: SHEET_MAX_WIDTH,
            },
          ]}>
          <View style={styles.modalHeader}>
            <View style={styles.headerIndicator} />
            <Pressable
              onPress={onClose}
              style={[styles.closeButton, { backgroundColor: themeColors.card }]}>
              <Text style={[styles.closeText, { color: themeColors.text }]}>x</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            <View
              style={[
                styles.heroCard,
                { backgroundColor: themeColors.card, borderColor: themeColors.border },
              ]}>
              <View style={[styles.heroIcon, { borderColor: themeColors.border }]}>
                <Text style={[styles.heroIconText, { color: themeColors.primary }]}>
                  {isIncome ? '$' : 'ED'}
                </Text>
              </View>
              <Text style={[styles.heroEyebrow, { color: themeColors.muted }]}>
                {isIncome ? 'INGRESO DETECTADO' : 'GASTO DETECTADO'}
              </Text>
              <Text numberOfLines={2} style={[styles.heroTitle, { color: themeColors.text }]}>
                {merchantName.toUpperCase()}
              </Text>
              <Text style={[styles.heroAmount, { color: isIncome ? themeColors.tertiary : themeColors.primary }]}>
                {formatCOP(tx.amount)}
              </Text>
              <Text style={[styles.heroDate, { color: themeColors.muted }]}>
                Pago procesado el {formatDate(tx.date)}
              </Text>
            </View>

            <View style={styles.instructionBlock}>
              <Text style={[styles.instructionTitle, { color: themeColors.text }]}>
                A que subcategoria pertenece?
              </Text>
              <Text style={[styles.instructionBody, { color: themeColors.muted }]}>
                Tu organizacion ayuda a nuestra IA local a entenderte mejor.
              </Text>
            </View>

            {!showAllCategories ? (
              <View style={styles.quickGrid}>
                {quickCategories.map(category => (
                  <CategoryTile
                    key={category.key}
                    active={selectedCategoryId === category.id}
                    color={category.color}
                    icon={category.icon}
                    label={category.name}
                    onPress={() => setSelectedCategoryId(category.id)}
                    palette={themeColors}
                    tileWidth={categoryTileWidth}
                  />
                ))}
                <CategoryTile
                  active={false}
                  color="#c5c5d9"
                  icon="..."
                  label="Otros"
                  onPress={() => setShowAllCategories(true)}
                  palette={themeColors}
                  tileWidth={categoryTileWidth}
                />
              </View>
            ) : (
              <View style={styles.othersContainer}>
                <Pressable onPress={() => setShowAllCategories(false)} style={styles.backButton}>
                  <Text style={[styles.backButtonText, { color: themeColors.primary }]}>
                    Volver a categorias rapidas
                  </Text>
                </Pressable>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {categories.map(category => (
                    <Pressable
                      key={category.id}
                      onPress={() => {
                        setSelectedCategoryId(category.id);
                        setShowAllCategories(false);
                      }}
                      style={[
                        styles.fullCategoryChip,
                        {
                          backgroundColor: `${category.color}22`,
                          borderColor: category.color,
                        },
                      ]}>
                      <Text style={[styles.fullCategoryText, { color: themeColors.text }]}>
                        {category.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={[styles.createForm, { borderColor: themeColors.border }]}>
                  <Text style={[styles.createTitle, { color: themeColors.text }]}>Crear nueva categoria</Text>
                  <TextInput
                    onChangeText={setNewCatName}
                    placeholder="Ej. Universidad, Mascotas, Regalos"
                    placeholderTextColor={themeColors.muted}
                    style={[
                      styles.createInput,
                      {
                        backgroundColor: themeColors.card,
                        borderColor: themeColors.border,
                        color: themeColors.text,
                      },
                    ]}
                    value={newCatName}
                  />
                  <View style={styles.paletteRow}>
                    {paletteColors.map(color => (
                      <Pressable
                        key={color}
                        onPress={() => setSelectedColor(color)}
                        style={[
                          styles.colorCircle,
                          { backgroundColor: color },
                          selectedColor === color && styles.colorCircleActive,
                        ]}
                      />
                    ))}
                  </View>
                  <Pressable
                    onPress={handleCreateAndSelectCategory}
                    style={[styles.secondaryActionButton, { borderColor: themeColors.border }]}>
                    <Text style={[styles.secondaryActionText, { color: themeColors.text }]}>
                      Crear y seleccionar
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Pressable
              onPress={() => setApplyToFuture(current => !current)}
              style={[styles.ruleCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
              <View style={styles.ruleLeft}>
                <View style={[styles.ruleIcon, { backgroundColor: 'rgba(0, 228, 117, 0.12)' }]}>
                  <Text style={[styles.ruleIconText, { color: themeColors.tertiary }]}>AI</Text>
                </View>
                <View>
                  <Text style={[styles.ruleTitle, { color: themeColors.text }]}>Guardar regla automatica</Text>
                  <Text style={[styles.ruleSubtitle, { color: themeColors.tertiary }]}>RECOMENDADO</Text>
                </View>
              </View>
              <Switch
                onValueChange={setApplyToFuture}
                thumbColor={applyToFuture ? '#003918' : '#f1f0ff'}
                trackColor={{ false: themeColors.border, true: themeColors.tertiary }}
                value={applyToFuture}
              />
            </Pressable>

            <Pressable
              onPress={confirmCategory}
              style={[styles.primaryButton, { backgroundColor: themeColors.primary }]}>
              <Text style={styles.primaryButtonText}>
                {selectedCategory ? `Confirmar ${selectedCategory.name}` : 'Confirmar Seleccion'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleEditPress}
              style={[styles.editButton, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
              <Text style={[styles.editButtonText, { color: themeColors.muted }]}>Editar Detalles</Text>
            </Pressable>

            <Pressable
              onPress={handleDeletePress}
              style={[styles.deleteButton, { backgroundColor: isDark ? 'rgba(255, 180, 171, 0.10)' : 'rgba(186, 26, 26, 0.06)', borderColor: themeColors.danger }]}>
              <Text style={[styles.deleteButtonText, { color: themeColors.danger }]}>Eliminar Transaccion</Text>
            </Pressable>

            <Text style={[styles.footerHint, { color: themeColors.muted }]}>
              La proxima vez lo clasificaremos por ti
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CategoryTile({
  active,
  color,
  icon,
  label,
  onPress,
  palette,
  tileWidth,
}: {
  active: boolean;
  color: string;
  icon: string;
  label: string;
  onPress: () => void;
  palette: ThemeColors;
  tileWidth: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.categoryTile,
        {
          backgroundColor: palette.card,
          borderColor: active ? palette.primary : palette.border,
          borderWidth: active ? 2 : 1,
          width: tileWidth,
        },
      ]}>
      <Text style={[styles.categoryIcon, { color: active ? palette.primary : color }]}>{icon}</Text>
      <Text
        numberOfLines={1}
        style={[styles.categoryText, { color: active ? palette.primary : palette.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    paddingVertical: 4,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '900',
  },
  categoryIcon: {
    fontSize: 18,
    fontWeight: '900',
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '900',
    maxWidth: '100%',
  },
  categoryTile: {
    alignItems: 'center',
    borderRadius: 18,
    gap: 8,
    height: 86,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 32,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '900',
  },
  colorCircle: {
    borderRadius: 14,
    height: 28,
    width: 28,
  },
  colorCircleActive: {
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.14 }],
  },
  createForm: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  createInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  createTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 58,
    justifyContent: 'center',
  },
  deleteButtonText: {
    fontSize: 18,
    fontWeight: '900',
  },
  editButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 58,
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 20,
    fontWeight: '900',
  },
  footerHint: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  fullCategoryChip: {
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fullCategoryText: {
    fontSize: 13,
    fontWeight: '800',
  },
  headerIndicator: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 3,
    height: 5,
    width: 48,
  },
  heroAmount: {
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 44,
  },
  heroCard: {
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 1,
    gap: 8,
    overflow: 'hidden',
    padding: 22,
  },
  heroDate: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(187, 195, 255, 0.12)',
    borderRadius: 18,
    borderWidth: 1,
    height: 66,
    justifyContent: 'center',
    marginBottom: 8,
    width: 66,
  },
  heroIconText: {
    fontSize: 18,
    fontWeight: '900',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  instructionBlock: {
    alignItems: 'center',
    gap: 6,
  },
  instructionBody: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  instructionTitle: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalHeader: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
  },
  modalOverlay: {
    backgroundColor: 'rgba(5, 4, 8, 0.78)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  othersContainer: {
    gap: 14,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    minHeight: 64,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#001d93',
    fontSize: 20,
    fontWeight: '900',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  ruleCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ruleIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  ruleIconText: {
    fontSize: 13,
    fontWeight: '900',
  },
  ruleLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: 12,
  },
  ruleSubtitle: {
    fontSize: 10,
    fontWeight: '900',
  },
  ruleTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  scrollContent: {
    gap: 20,
    paddingBottom: 42,
    paddingTop: 8,
  },
  secondaryActionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '900',
  },
  sheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    maxHeight: '94%',
    paddingHorizontal: 20,
    paddingTop: 12,
    width: '100%',
  },
});

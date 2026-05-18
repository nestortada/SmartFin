import React, { useState, useEffect } from 'react';
import {
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
import type { Transaction } from '../../types';
import type { Category } from '../../../categories/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type CategorizationModalProps = {
  visible: boolean;
  onClose: () => void;
  tx: Transaction | null;
  isDark: boolean;
  themeColors: any;
  categories: Category[];
  onSelectCategory: (categoryId: string, applyToFuture: boolean) => Promise<void>;
  onDeleteTransaction: (id: string) => Promise<void>;
  onCreateCategory: (name: string, color: string) => Promise<Category | null>;
};

export const CategorizationModal: React.FC<CategorizationModalProps> = ({
  visible,
  onClose,
  tx,
  isDark,
  themeColors,
  categories,
  onSelectCategory,
  onDeleteTransaction,
  onCreateCategory,
}) => {
  const [applyToFuture, setApplyToFuture] = useState(true);
  const [showAllCategories, setShowAllCategories] = useState(false);
  
  // Custom Category creation states
  const [newCatName, setNewCatName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#cdbdff');

  const paletteColors = [
    '#bbc3ff', // Soft Blue
    '#cdbdff', // Light Purple
    '#8ea2ff', // Deep Blue
    '#d7b7ff', // Vibrant Pink/Purple
    '#ffb4ab', // Coral Pink
    '#8fd8ff', // Sky Blue
    '#62ff96', // Neon Light Green
    '#ffd062', // Honey Gold
  ];

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setApplyToFuture(true);
      setShowAllCategories(false);
      setNewCatName('');
      setSelectedColor(paletteColors[0] || '#cdbdff');
    }
  }, [visible]);

  if (!tx) return null;

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

  const formatDate = (dateStr: string) => {
    try {
      const parts = dateStr.slice(0, 10).split('-');
      if (parts.length < 3) return dateStr;
      const [year, month, day] = parts;
      const monthsSpanish = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
      ];
      const monthIndex = parseInt(month || '1', 10) - 1;
      const monthName = monthsSpanish[monthIndex] || 'Enero';
      return `${parseInt(day || '1', 10)} de ${monthName} de ${year}`;
    } catch {
      return dateStr;
    }
  };

  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(val);
  };

  const quickCategories = [
    { macro: 'food', name: 'Alimentación', icon: '🍔', id: 'category-food', color: '#bbc3ff' },
    { macro: 'transport', name: 'Transporte', icon: '🚗', id: 'category-transport', color: '#cdbdff' },
    { macro: 'housing', name: 'Vivienda', icon: '🏠', id: 'category-housing', color: '#8ea2ff' },
    { macro: 'entertainment', name: 'Entretenimiento', icon: '🍿', id: 'category-entertainment', color: '#d7b7ff' },
    { macro: 'health', name: 'Salud', icon: '💊', id: 'category-health', color: '#ffb4ab' },
    { macro: 'utilities', name: 'Servicios', icon: '💡', id: 'category-utilities', color: '#8fd8ff' },
    { macro: 'debts', name: 'Deudas', icon: '💳', id: 'category-debts', color: '#c0acff' },
    { macro: 'investments', name: 'Inversiones', icon: '📈', id: 'category-investments', color: '#62ff96' },
  ];

  const handleSelectQuick = async (catId: string) => {
    // Find if the category actually exists in loaded db categories
    const found = categories.find(c => c.id === catId);
    if (found) {
      await onSelectCategory(found.id, applyToFuture);
      onClose();
    } else {
      // Fallback
      await onSelectCategory(catId, applyToFuture);
      onClose();
    }
  };

  const handleCreateAndSelectCategory = async () => {
    if (!newCatName.trim()) {
      Alert.alert('Error', 'Por favor ingresa un nombre para la categoría.');
      return;
    }
    const newCat = await onCreateCategory(newCatName.trim(), selectedColor);
    if (newCat) {
      await onSelectCategory(newCat.id, applyToFuture);
      onClose();
    }
  };

  const handleDeletePress = () => {
    Alert.alert(
      '¿Eliminar este movimiento?',
      'Esta acción eliminará de forma permanente el registro de la base de datos y no se podrá deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Eliminar', 
          style: 'destructive',
          onPress: async () => {
            await onDeleteTransaction(tx.id);
            onClose();
          } 
        }
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        {/* Glowing Background Blur Effects */}
        {isDark && (
          <View style={styles.glowContainer} pointerEvents="none">
            <View style={[styles.glowSpherePurple, { backgroundColor: selectedColor }]} />
          </View>
        )}

        <View style={[
          styles.glassModal,
          { 
            backgroundColor: isDark ? 'rgba(20, 18, 30, 0.88)' : 'rgba(255, 255, 255, 0.94)', 
            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(35, 42, 65, 0.12)'
          }
        ]}>
          {/* Header Bar */}
          <View style={styles.modalHeader}>
            <View style={styles.headerIndicator} />
            <Pressable onPress={onClose} style={[styles.closeButton, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0,0,0,0.05)' }]}>
              <Text style={[styles.closeText, { color: themeColors.text }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Purchase Detection Details */}
            <View style={styles.gastoHeader}>
              <View style={styles.gastoDetectadoBadge}>
                <Text style={styles.gastoDetectadoBadgeText}>🚨 GASTO DETECTADO</Text>
              </View>
              <Text style={[styles.merchantTitle, { color: themeColors.text }]}>
                {tx.merchantName || tx.description}
              </Text>
              <Text style={[styles.dateText, { color: themeColors.muted }]}>
                Pago procesado el {formatDate(tx.date)}
              </Text>
              <Text style={[styles.amountText, { color: themeColors.text }]}>
                {formatCOP(tx.amount)}
              </Text>
            </View>

            {/* Instruction Call */}
            <View style={styles.instructionContainer}>
              <Text style={[styles.instructionTitle, { color: themeColors.text }]}>
                ¿A qué categoría pertenece?
              </Text>
              <Text style={[styles.instructionDesc, { color: themeColors.muted }]}>
                Tu organización ayuda a nuestra IA local a entenderte mejor.
              </Text>
            </View>

            {/* Automatic Rule Toggle */}
            <Pressable 
              onPress={() => setApplyToFuture(!applyToFuture)}
              style={[
                styles.ruleToggleCard, 
                { 
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)',
                  borderColor: applyToFuture ? '#00e475' : themeColors.border
                }
              ]}>
              <View style={[styles.checkboxCircle, { borderColor: applyToFuture ? '#00e475' : themeColors.muted }]}>
                {applyToFuture && <View style={styles.checkboxDot} />}
              </View>
              <View style={styles.toggleTextContainer}>
                <Text style={[styles.toggleTitle, { color: themeColors.text }]}>
                  Guardar regla automática
                </Text>
                <Text style={[styles.toggleDesc, { color: '#00e475', fontWeight: '600' }]}>
                  Recomendado • La próxima vez lo clasificaremos por ti
                </Text>
              </View>
            </Pressable>

            {!showAllCategories ? (
              <>
                {/* Grid of Quick Categories */}
                <View style={styles.quickGrid}>
                  {quickCategories.map(cat => {
                    const dbCat = categories.find(c => c.id === cat.id) || categories.find(c => c.macroCategory === cat.macro);
                    const color = dbCat?.color || cat.color;
                    const name = dbCat?.name || cat.name;
                    return (
                      <Pressable
                        key={cat.id}
                        onPress={() => handleSelectQuick(cat.id)}
                        style={[
                          styles.categoryCard,
                          { 
                            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)',
                            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(35, 42, 65, 0.06)'
                          }
                        ]}>
                        <View style={[styles.iconBox, { backgroundColor: color + '22', borderColor: color }]}>
                          <Text style={styles.iconEmoji}>{cat.icon}</Text>
                        </View>
                        <Text numberOfLines={1} style={[styles.categoryCardText, { color: themeColors.text }]}>
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* "Otros" selection chip */}
                  <Pressable
                    onPress={() => setShowAllCategories(true)}
                    style={[
                      styles.categoryCard,
                      { 
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)',
                        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(35, 42, 65, 0.06)'
                      }
                    ]}>
                    <View style={[styles.iconBox, { backgroundColor: 'rgba(197, 197, 217, 0.22)', borderColor: '#c5c5d9' }]}>
                      <Text style={styles.iconEmoji}>📦</Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.categoryCardText, { color: themeColors.text, fontWeight: '700' }]}>
                      Otros
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              /* "Otros" view: Shows all categories + create new category option */
              <View style={styles.othersContainer}>
                {/* Back to quick select */}
                <Pressable onPress={() => setShowAllCategories(false)} style={styles.backButton}>
                  <Text style={[styles.backButtonText, { color: themeColors.primary }]}>← Volver a categorías rápidas</Text>
                </Pressable>

                <Text style={[styles.sectionSubtitle, { color: themeColors.text }]}>Todas las categorías existentes</Text>
                
                {/* Horizontal scroll of all categories */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fullCategoriesScroll}>
                  {categories.map(c => (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        onSelectCategory(c.id, applyToFuture);
                        onClose();
                      }}
                      style={[
                        styles.fullCategoryChip,
                        { 
                          backgroundColor: c.color + '15',
                          borderColor: c.color,
                        }
                      ]}>
                      <Text style={styles.chipEmoji}>{getCategoryIcon(c.macroCategory)}</Text>
                      <Text style={[styles.chipText, { color: themeColors.text }]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Create Custom Category Form */}
                <View style={[styles.createForm, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)', borderColor: themeColors.border }]}>
                  <Text style={[styles.createTitle, { color: themeColors.text }]}>Crear nueva categoría</Text>
                  <Text style={[styles.createDesc, { color: themeColors.muted }]}>Si no encuentras una adecuada, créala de forma local y privada.</Text>
                  
                  <TextInput
                    placeholder="Ej. Estudios, Mascotas, Regalos"
                    placeholderTextColor={themeColors.muted}
                    value={newCatName}
                    onChangeText={setNewCatName}
                    style={[styles.createInput, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : '#fff' }]}
                  />

                  {/* Color Palette Selector */}
                  <Text style={[styles.createSubLabel, { color: themeColors.muted }]}>Color de la categoría</Text>
                  <View style={styles.paletteRow}>
                    {paletteColors.map(c => (
                      <Pressable
                        key={c}
                        onPress={() => setSelectedColor(c)}
                        style={[
                          styles.colorCircle,
                          { backgroundColor: c },
                          selectedColor === c && { borderColor: '#fff', borderWidth: 2, transform: [{ scale: 1.15 }] }
                        ]}
                      />
                    ))}
                  </View>

                  <Pressable 
                    onPress={handleCreateAndSelectCategory}
                    style={[styles.createBtn, { backgroundColor: themeColors.primary }]}>
                    <Text style={styles.createBtnText}>Crear y Seleccionar</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Delete Transaction action */}
            <Pressable 
              onPress={handleDeletePress}
              style={[
                styles.deleteBtn, 
                { 
                  backgroundColor: isDark ? 'rgba(255, 180, 171, 0.08)' : 'rgba(186, 26, 26, 0.06)',
                  borderColor: themeColors.danger
                }
              ]}>
              <Text style={[styles.deleteBtnText, { color: themeColors.danger }]}>
                🗑️ Eliminar este movimiento de la base de datos
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    backgroundColor: 'rgba(5, 4, 8, 0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  glowContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glowSpherePurple: {
    borderRadius: 150,
    bottom: -50,
    height: 300,
    opacity: 0.15,
    position: 'absolute',
    width: 300,
  },
  glassModal: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '92%',
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: {
      height: -8,
      width: 0,
    },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  headerIndicator: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    height: 6,
    width: 48,
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
    fontSize: 12,
    fontWeight: '800',
  },
  scrollContent: {
    gap: 22,
    paddingBottom: 50,
    paddingTop: 8,
  },
  gastoHeader: {
    alignItems: 'center',
    gap: 8,
  },
  gastoDetectadoBadge: {
    backgroundColor: 'rgba(255, 180, 171, 0.12)',
    borderColor: 'rgba(255, 180, 171, 0.3)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  gastoDetectadoBadgeText: {
    color: '#ffb4ab',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  merchantTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
  },
  amountText: {
    fontSize: 28,
    fontWeight: '900',
    marginTop: 4,
  },
  instructionContainer: {
    gap: 4,
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  instructionDesc: {
    fontSize: 12,
    fontWeight: '500',
  },
  ruleToggleCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  checkboxCircle: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxDot: {
    backgroundColor: '#00e475',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  toggleTextContainer: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  toggleDesc: {
    fontSize: 10,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  categoryCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    paddingHorizontal: 12,
    width: (SCREEN_WIDTH - 52) / 2, // dynamic columns
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  iconEmoji: {
    fontSize: 15,
  },
  categoryCardText: {
    fontSize: 12,
    fontWeight: '700',
  },
  othersContainer: {
    gap: 16,
  },
  backButton: {
    paddingVertical: 4,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  fullCategoriesScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  fullCategoryChip: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  createForm: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  createTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  createDesc: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: -4,
  },
  createInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 13,
    fontWeight: '600',
    height: 44,
    paddingHorizontal: 12,
  },
  createSubLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  colorCircle: {
    borderRadius: 14,
    height: 28,
    width: 28,
  },
  createBtn: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    marginTop: 6,
  },
  createBtnText: {
    color: '#001d93',
    fontSize: 13,
    fontWeight: '800',
  },
  deleteBtn: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    marginTop: 8,
  },
  deleteBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
});

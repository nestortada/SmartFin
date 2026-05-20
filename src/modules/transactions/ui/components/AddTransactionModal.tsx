import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import type { Account } from '../../../accounts';
import type { Category } from '../../../categories';
import type { TransactionType } from '../../types';

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

type AddTransactionModalProps = {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeColors: ThemeColors;
  categories: Category[];
  accounts: Account[];
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
  newTargetAccount: string;
  setNewTargetAccount: (val: string) => void;
  newCreditCardHint: string;
  setNewCreditCardHint: (val: string) => void;
  newNotes: string;
  setNewNotes: (val: string) => void;
  newOperationType: 'Débito' | 'Crédito';
  setNewOperationType: (val: 'Débito' | 'Crédito') => void;
  creditInstallmentCount: string;
  setCreditInstallmentCount: (val: string) => void;
  hasInterestFreeInstallments: boolean;
  setHasInterestFreeInstallments: (val: boolean) => void;
  interestFreeInstallmentCount: string;
  setInterestFreeInstallmentCount: (val: string) => void;
  opTypePickerVisible: boolean;
  setOpTypePickerVisible: (val: boolean) => void;
  onCreateCategory: (name: string, type: 'income' | 'expense') => Promise<Category | null>;
  onCreateAccount: (name: string, type: 'bankAccount' | 'creditCard') => Promise<Account | null>;
  onCreateCreditCard: () => void;
  mode?: 'create' | 'edit';
  onSave: () => void;
};

export function AddTransactionModal({
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
  newTargetAccount,
  setNewTargetAccount,
  newCreditCardHint,
  setNewCreditCardHint,
  newNotes,
  setNewNotes,
  newOperationType,
  setNewOperationType,
  creditInstallmentCount,
  setCreditInstallmentCount,
  hasInterestFreeInstallments,
  setHasInterestFreeInstallments,
  interestFreeInstallmentCount,
  setInterestFreeInstallmentCount,
  onCreateCategory,
  onCreateAccount,
  onCreateCreditCard,
  mode = 'create',
  onSave,
}: AddTransactionModalProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [installmentPickerOpen, setInstallmentPickerOpen] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [customAccountName, setCustomAccountName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);

  const isIncome = newType === 'income';
  const isTransfer = newType === 'internalTransfer';
  const title = mode === 'edit'
    ? `Modificar ${isTransfer ? 'Transferencia' : isIncome ? 'Ingreso' : 'Gasto'}`
    : isTransfer
      ? 'Transferir'
      : isIncome
      ? 'Anadir Ingreso'
      : 'Anadir Gasto';
  const selectedCategory = categories.find(category => category.id === newCategory);
  const visibleCategories = useMemo(
    () =>
      categories.filter(category =>
        isIncome || isTransfer
          ? category.type === 'income'
          : category.type === 'expense' || category.type === 'debt',
      ),
    [categories, isIncome],
  );
  const visibleAccounts = useMemo(
    () =>
      accounts
        .filter(account => account.status === 'active')
        .filter(account => {
          if (isIncome || isTransfer) {
            return isDebitAccount(account);
          }

          return isCreditOperation(newOperationType)
            ? account.type === 'creditCard'
            : isDebitAccount(account);
        }),
    [accounts, isIncome, isTransfer, newOperationType],
  );
  const targetAccounts = useMemo(
    () =>
      accounts
        .filter(account => account.status === 'active')
        .filter(isDebitAccount)
        .filter(account => account.id !== newAccount),
    [accounts, newAccount],
  );
  const selectedAccount = visibleAccounts.find(account => account.id === newAccount);
  const selectedTargetAccount = targetAccounts.find(account => account.id === newTargetAccount);
  const isCreditPayment = !isIncome && !isTransfer && isCreditOperation(newOperationType);

  const normalizedAmount = formatAmountInput(newAmount);
  const amountNumber = parseAmountInput(normalizedAmount);
  const amountDisplay = amountNumber
    ? amountNumber.toLocaleString('es-CO')
    : '0';
  const isCompactPhone = windowWidth < 360;
  const screenPadding = isCompactPhone ? 14 : 20;
  const titleFontSize = isCompactPhone ? 20 : 24;
  const amountFontSize = isCompactPhone ? 30 : 38;
  const amountLineHeight = isCompactPhone ? 38 : 48;

  const selectType = (type: TransactionType) => {
    setNewType(type);
    setNewCategory('');
    setNewAccount('');
    setNewTargetAccount('');
    setNewCreditCardHint('');
    if (type === 'internalTransfer') {
      setNewOperationType('Débito');
    }
    setCategoryPickerOpen(false);
    setAccountPickerOpen(false);
  };

  const createCategory = async () => {
    const name = customCategoryName.trim();
    if (!name) {
      return;
    }

    setCreatingCategory(true);
    try {
      const category = await onCreateCategory(name, isIncome ? 'income' : 'expense');
      if (category) {
        setNewCategory(category.id);
        setCustomCategoryName('');
        setCategoryPickerOpen(false);
      }
    } finally {
      setCreatingCategory(false);
    }
  };

  const createAccount = async () => {
    if (!isIncome && isCreditOperation(newOperationType)) {
      openCreditCardForm();
      setAccountPickerOpen(false);
      return;
    }

    const name = customAccountName.trim();
    if (!name) {
      return;
    }

    setCreatingAccount(true);
    try {
      const account = await onCreateAccount(
        name,
        !isIncome && isCreditOperation(newOperationType) ? 'creditCard' : 'bankAccount',
      );
      if (account) {
        setNewAccount(account.id);
        setCustomAccountName('');
        setAccountPickerOpen(false);
      }
    } finally {
      setCreatingAccount(false);
    }
  };

  const openCreditCardForm = () => {
    onCreateCreditCard();
    setAccountPickerOpen(false);
  };

  const selectInstallmentCount = (value: string) => {
    setCreditInstallmentCount(value);
    const count = Number(value);
    if (count <= 1) {
      setHasInterestFreeInstallments(false);
      setInterestFreeInstallmentCount('');
      return;
    }

    if (hasInterestFreeInstallments) {
      const currentInterestFreeCount = Number(interestFreeInstallmentCount) || 0;
      if (currentInterestFreeCount > count) {
        setInterestFreeInstallmentCount(value);
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.sheet, { backgroundColor: themeColors.background, borderColor: themeColors.border }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.backButton}>
              <Text style={[styles.backIcon, { color: themeColors.primary }]}>‹</Text>
            </Pressable>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[styles.title, { color: themeColors.text, fontSize: titleFontSize }]}>
              {title}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          {isDark ? (
            <>
              <View style={styles.primaryGlow} />
              <View style={styles.tertiaryGlow} />
            </>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, { paddingHorizontal: screenPadding }]}>
            <View style={[styles.typeSwitch, { backgroundColor: isDark ? '#2a2a2b' : '#e8e7ef' }]}>
              <Pressable
                onPress={() => selectType('expense')}
                style={[
                  styles.typeOption,
                  !isIncome && { backgroundColor: themeColors.primary },
                ]}>
                <Text style={[styles.typeText, { color: !isIncome ? '#f1f0ff' : themeColors.muted }]}>Gasto</Text>
              </Pressable>
              <Pressable
                onPress={() => selectType('income')}
                style={[
                  styles.typeOption,
                  isIncome && { backgroundColor: themeColors.primary },
                ]}>
                <Text style={[styles.typeText, { color: isIncome ? '#f1f0ff' : themeColors.muted }]}>Ingreso</Text>
              </Pressable>
              <Pressable
                onPress={() => selectType('internalTransfer')}
                style={[
                  styles.typeOption,
                  isTransfer && { backgroundColor: themeColors.primary },
                ]}>
                <Text style={[styles.typeText, { color: isTransfer ? '#f1f0ff' : themeColors.muted }]}>Transferir</Text>
              </Pressable>
            </View>

            <View style={styles.amountBlock}>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={[
                  styles.amountText,
                  {
                    color: isIncome ? themeColors.text : themeColors.primary,
                    fontSize: amountFontSize,
                    lineHeight: amountLineHeight,
                  },
                ]}>
                <Text style={{ color: isIncome ? themeColors.tertiary : themeColors.primary }}>
                  {isIncome ? '+ ' : '- '}
                </Text>
                {amountDisplay}
                <Text style={[styles.currencyText, { color: themeColors.muted }]}> COP</Text>
              </Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={value => setNewAmount(formatAmountInput(value))}
                placeholder="Toque para editar monto"
                placeholderTextColor={themeColors.muted}
                style={[styles.amountInput, { borderColor: themeColors.border, color: themeColors.text }]}
                value={normalizedAmount}
              />
            </View>

            <TransactionNameField
              icon="TX"
              label="Nombre de la transaccion"
              onChangeText={setNewMerchant}
              palette={themeColors}
              placeholder={isIncome ? 'Ej: Pago de consultoria' : 'Ej: Cena con amigos'}
              value={newMerchant}
            />

            {!isTransfer ? (
              <PickerField
                icon={isIncome ? '$' : 'CT'}
                label="Categoria"
                onPress={() => setCategoryPickerOpen(current => !current)}
                palette={themeColors}
                subtitle={visibleCategories.length === 0 ? 'Crea una categoria local' : undefined}
                title={selectedCategory?.name ?? 'Otro'}
              />
            ) : null}
            {!isTransfer && categoryPickerOpen ? (
              <PickerPanel palette={themeColors}>
                {visibleCategories.map(category => (
                  <PickerOption
                    key={category.id}
                    active={category.id === newCategory}
                    label={category.name}
                    onPress={() => {
                      setNewCategory(category.id);
                      setCategoryPickerOpen(false);
                    }}
                    palette={themeColors}
                    tone={category.color}
                  />
                ))}
                <CreateInline
                  buttonLabel={creatingCategory ? 'Creando...' : 'Crear categoria'}
                  onChangeText={setCustomCategoryName}
                  onSubmit={createCategory}
                  palette={themeColors}
                  placeholder="Nueva categoria"
                  value={customCategoryName}
                />
              </PickerPanel>
            ) : null}

            {!isIncome && !isTransfer ? (
              <GlassCard palette={themeColors}>
                <View style={styles.rowHeader}>
                  <IconBubble label="$" palette={themeColors} />
                  <View style={styles.fieldContent}>
                    <Text style={[styles.fieldLabel, { color: themeColors.muted }]}>Tipo de Pago</Text>
                    <View style={[styles.paymentSwitch, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                      {(['Débito', 'Crédito'] as const).map(option => (
                        <Pressable
                          key={option}
                          onPress={() => {
                            setNewOperationType(option);
                            setNewAccount('');
                            setNewCreditCardHint('');
                            if (!isCreditOperation(option)) {
                              setCreditInstallmentCount('1');
                              setHasInterestFreeInstallments(false);
                              setInterestFreeInstallmentCount('');
                            }
                            setInstallmentPickerOpen(false);
                            setAccountPickerOpen(false);
                          }}
                          style={[
                            styles.paymentOption,
                            newOperationType === option && { backgroundColor: themeColors.primary },
                          ]}>
                          <Text style={[
                            styles.paymentText,
                            { color: newOperationType === option ? '#f1f0ff' : themeColors.muted },
                          ]}>
                            {option}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </GlassCard>
            ) : null}

            {isCreditPayment && !isTransfer ? (
              <>
                <PickerField
                  icon="CQ"
                  label="Numero de cuotas"
                  onPress={() => setInstallmentPickerOpen(current => !current)}
                  palette={themeColors}
                  subtitle={
                    hasInterestFreeInstallments && interestFreeInstallmentCount
                      ? `${interestFreeInstallmentCount} sin intereses`
                      : 'Compra financiada con tarjeta'
                  }
                  title={`${creditInstallmentCount || '1'} cuota${creditInstallmentCount === '1' ? '' : 's'}`}
                />
                {installmentPickerOpen ? (
                  <PickerPanel palette={themeColors}>
                    <View style={styles.installmentGrid}>
                      {['1', '3', '6', '12', '18', '24', '36'].map(option => (
                        <Pressable
                          key={option}
                          onPress={() => selectInstallmentCount(option)}
                          style={[
                            styles.installmentChip,
                            {
                              backgroundColor:
                                creditInstallmentCount === option
                                  ? themeColors.primary
                                  : 'rgba(255,255,255,0.04)',
                              borderColor:
                                creditInstallmentCount === option
                                  ? themeColors.primary
                                  : themeColors.border,
                            },
                          ]}>
                          <Text
                            style={[
                              styles.installmentChipText,
                              {
                                color:
                                  creditInstallmentCount === option
                                    ? '#001d93'
                                    : themeColors.text,
                              },
                            ]}>
                            {option}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {Number(creditInstallmentCount) > 1 ? (
                      <View style={[styles.interestFreeCard, { borderColor: themeColors.border }]}>
                        <Pressable
                          onPress={() => {
                            const nextValue = !hasInterestFreeInstallments;
                            setHasInterestFreeInstallments(nextValue);
                            setInterestFreeInstallmentCount(nextValue ? creditInstallmentCount : '');
                          }}
                          style={styles.interestFreeHeader}>
                          <View style={styles.fieldContent}>
                            <Text style={[styles.fieldLabel, { color: themeColors.muted }]}>
                              Cuotas sin intereses
                            </Text>
                            <Text style={[styles.fieldSubtitle, { color: themeColors.text }]}>
                              Activa si una parte del plan no genera intereses
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.switchPill,
                              {
                                backgroundColor: hasInterestFreeInstallments
                                  ? themeColors.tertiary
                                  : themeColors.border,
                              },
                            ]}>
                            <View
                              style={[
                                styles.switchKnob,
                                hasInterestFreeInstallments && styles.switchKnobOn,
                              ]}
                            />
                          </View>
                        </Pressable>

                        {hasInterestFreeInstallments ? (
                          <View style={styles.installmentGrid}>
                            {Array.from(
                              { length: Math.max(Number(creditInstallmentCount) || 1, 1) },
                              (_, index) => String(index + 1),
                            ).map(option => (
                              <Pressable
                                key={option}
                                onPress={() => setInterestFreeInstallmentCount(option)}
                                style={[
                                  styles.installmentChip,
                                  {
                                    backgroundColor:
                                      interestFreeInstallmentCount === option
                                        ? 'rgba(0, 228, 117, 0.18)'
                                        : 'rgba(255,255,255,0.04)',
                                    borderColor:
                                      interestFreeInstallmentCount === option
                                        ? themeColors.tertiary
                                        : themeColors.border,
                                  },
                                ]}>
                                <Text
                                  style={[
                                    styles.installmentChipText,
                                    {
                                      color:
                                        interestFreeInstallmentCount === option
                                          ? themeColors.tertiary
                                          : themeColors.text,
                                    },
                                  ]}>
                                  {option}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </PickerPanel>
                ) : null}
              </>
            ) : null}

            <PickerField
              icon="BK"
              label={isIncome ? 'Cuenta de Destino' : 'Cuenta de origen'}
              onPress={() => setAccountPickerOpen(current => !current)}
              palette={themeColors}
              subtitle={
                selectedAccount?.institutionName ??
                (!isIncome && !isTransfer && isCreditOperation(newOperationType) ? 'Tarjetas de credito' : 'Cuentas debito')
              }
              title={selectedAccount?.name ?? (isCreditPayment && newCreditCardHint ? newCreditCardHint : 'Otro')}
            />
            {accountPickerOpen ? (
              <PickerPanel palette={themeColors}>
                {visibleAccounts.map(account => (
                    <PickerOption
                      key={account.id}
                      active={account.id === newAccount}
                      label={account.name}
                      onPress={() => {
                        setNewAccount(account.id);
                        setNewCreditCardHint(account.name);
                        setAccountPickerOpen(false);
                      }}
                      palette={themeColors}
                      subtitle={account.institutionName}
                    />
                  ))}
                {!isIncome && isCreditOperation(newOperationType) ? (
                  <>
                    <CreateCreditCardButton onPress={openCreditCardForm} palette={themeColors} />
                    <CreateInline
                      buttonLabel="Usar pendiente"
                      onChangeText={setNewCreditCardHint}
                      onSubmit={() => {
                        setNewAccount('');
                        setAccountPickerOpen(false);
                      }}
                      palette={themeColors}
                      placeholder="Tarjeta no creada"
                      value={newCreditCardHint}
                    />
                  </>
                ) : (
                  <CreateInline
                    buttonLabel={creatingAccount ? 'Creando...' : 'Crear banco'}
                    onChangeText={setCustomAccountName}
                    onSubmit={createAccount}
                    palette={themeColors}
                    placeholder="Nuevo banco o cuenta"
                    value={customAccountName}
                  />
                )}
              </PickerPanel>
            ) : null}

            {isTransfer ? (
              <>
                <PickerField
                  icon="TD"
                  label="Cuenta de destino"
                  onPress={() => undefined}
                  palette={themeColors}
                  subtitle={selectedTargetAccount?.institutionName ?? 'Tarjeta debito'}
                  title={selectedTargetAccount?.name ?? 'Selecciona destino'}
                />
                <PickerPanel palette={themeColors}>
                  {targetAccounts.map(account => (
                    <PickerOption
                      key={account.id}
                      active={account.id === newTargetAccount}
                      label={account.name}
                      onPress={() => setNewTargetAccount(account.id)}
                      palette={themeColors}
                      subtitle={account.institutionName}
                    />
                  ))}
                </PickerPanel>
              </>
            ) : null}

            {false ? (
              <GlassCard palette={themeColors}>
                <View style={styles.rowHeader}>
                  <IconBubble label="$" palette={themeColors} />
                  <View style={styles.fieldContent}>
                    <Text style={[styles.fieldLabel, { color: themeColors.muted }]}>Tipo de Pago</Text>
                    <View style={[styles.paymentSwitch, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                      {(['Débito', 'Crédito'] as const).map(option => (
                        <Pressable
                          key={option}
                          onPress={() => setNewOperationType(option)}
                          style={[
                            styles.paymentOption,
                            newOperationType === option && { backgroundColor: themeColors.primary },
                          ]}>
                          <Text style={[
                            styles.paymentText,
                            { color: newOperationType === option ? '#f1f0ff' : themeColors.muted },
                          ]}>
                            {option}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </GlassCard>
            ) : null}

            <PickerField
              icon="FE"
              label="Fecha"
              onPress={() => undefined}
              palette={themeColors}
              rightIcon="ED"
              title={formatTodayLabel()}
            />

            <TransactionNameField
              icon="NO"
              label="Nota (Opcional)"
              onChangeText={setNewNotes}
              palette={themeColors}
              placeholder={isIncome ? 'Anade un comentario...' : 'Ej: Almuerzo de trabajo'}
              value={newNotes}
            />

            {!isIncome && !isTransfer ? (
              <Pressable style={[styles.receiptButton, { borderColor: themeColors.border }]}>
                <Text style={[styles.receiptText, { color: themeColors.muted }]}>Adjuntar Recibo</Text>
              </Pressable>
            ) : (
              <View style={styles.suggestionRow}>
                {['Venta', 'Intereses', 'Regalo'].map(label => (
                  <Pressable
                    key={label}
                    onPress={() => setNewMerchant(label)}
                    style={[styles.suggestionChip, { backgroundColor: label === 'Venta' ? 'rgba(0, 228, 117, 0.12)' : themeColors.card }]}>
                    <Text style={[styles.suggestionText, { color: label === 'Venta' ? themeColors.tertiary : themeColors.muted }]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={[styles.actionArea, { paddingHorizontal: screenPadding }]}>
            <Pressable
              onPress={onSave}
              style={[
                styles.saveButton,
                { backgroundColor: isIncome ? '#bbc3ff' : themeColors.primary },
              ]}>
              <Text style={[styles.saveText, { color: isIncome ? '#001d93' : '#f1f0ff' }]}>
                {mode === 'edit' ? 'Guardar Cambios' : `Guardar ${isIncome ? 'Ingreso' : 'Gasto'}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TransactionNameField({
  icon,
  label,
  onChangeText,
  palette,
  placeholder,
  value,
}: {
  icon: string;
  label: string;
  onChangeText: (value: string) => void;
  palette: ThemeColors;
  placeholder: string;
  value: string;
}) {
  return (
    <GlassCard palette={palette}>
      <View style={styles.rowHeader}>
        <IconBubble label={icon} palette={palette} />
        <View style={styles.fieldContent}>
          <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
          <TextInput
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={palette.muted}
            style={[styles.inlineInput, { color: palette.text }]}
            value={value}
          />
        </View>
      </View>
    </GlassCard>
  );
}

function PickerField({
  icon,
  label,
  onPress,
  palette,
  rightIcon = '›',
  subtitle,
  title,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  palette: ThemeColors;
  rightIcon?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard palette={palette}>
        <View style={styles.pickerRow}>
          <View style={styles.rowHeader}>
            <IconBubble label={icon} palette={palette} />
            <View>
              <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
              <Text numberOfLines={1} style={[styles.fieldValue, { color: palette.text }]}>{title}</Text>
              {subtitle ? <Text style={[styles.fieldSubtitle, { color: palette.muted }]}>{subtitle}</Text> : null}
            </View>
          </View>
          <Text style={[styles.pickerArrow, { color: palette.muted }]}>{rightIcon}</Text>
        </View>
      </GlassCard>
    </Pressable>
  );
}

function GlassCard({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: ThemeColors;
}) {
  return (
    <View style={[styles.glassCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {children}
    </View>
  );
}

function IconBubble({ label, palette }: { label: string; palette: ThemeColors }) {
  return (
    <View style={[styles.iconBubble, { backgroundColor: 'rgba(187, 195, 255, 0.12)' }]}>
      <Text style={[styles.iconBubbleText, { color: palette.primary }]}>{label}</Text>
    </View>
  );
}

function PickerPanel({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: ThemeColors;
}) {
  return (
    <View style={[styles.pickerPanel, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {children}
    </View>
  );
}

function PickerOption({
  active,
  label,
  onPress,
  palette,
  subtitle,
  tone,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  palette: ThemeColors;
  subtitle?: string;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pickerOption,
        active && { borderColor: palette.primary, backgroundColor: 'rgba(61, 90, 254, 0.16)' },
      ]}>
      <View style={[styles.optionDot, { backgroundColor: tone ?? palette.primary }]} />
      <View style={styles.optionTextBlock}>
        <Text style={[styles.optionLabel, { color: palette.text }]}>{label}</Text>
        {subtitle ? <Text style={[styles.optionSubtitle, { color: palette.muted }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function CreateInline({
  buttonLabel,
  onChangeText,
  onSubmit,
  palette,
  placeholder,
  value,
}: {
  buttonLabel: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  palette: ThemeColors;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={[styles.createInline, { borderColor: palette.border }]}>
      <TextInput
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.createInput, { color: palette.text }]}
        value={value}
      />
      <Pressable onPress={onSubmit} style={[styles.createButton, { backgroundColor: palette.primary }]}>
        <Text style={styles.createButtonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

function CreateCreditCardButton({
  onPress,
  palette,
}: {
  onPress: () => void;
  palette: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.createCreditCardButton, { backgroundColor: palette.primary }]}>
      <Text style={styles.createButtonText}>Crear tarjeta</Text>
    </Pressable>
  );
}

function formatAmountInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return Number(digits).toLocaleString('es-CO');
}

function isCreditOperation(operationType: AddTransactionModalProps['newOperationType']): boolean {
  return operationType.toLowerCase().includes('cr');
}

function isDebitAccount(account: Account): boolean {
  return ['cash', 'bankAccount', 'savingsAccount'].includes(account.type);
}

export function parseAmountInput(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

function formatTodayLabel(): string {
  const now = new Date();
  const day = now.getDate();
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `Hoy, ${day} ${months[now.getMonth()]}`;
}

const styles = StyleSheet.create({
  actionArea: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  amountBlock: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  amountInput: {
    borderBottomWidth: 2,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
    minWidth: 180,
    paddingVertical: 8,
    textAlign: 'center',
  },
  amountText: {
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 48,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  backIcon: {
    fontSize: 38,
    fontWeight: '400',
  },
  content: {
    gap: 14,
    padding: 20,
    paddingBottom: 20,
  },
  createButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  createButtonText: {
    color: '#001d93',
    fontSize: 12,
    fontWeight: '900',
  },
  createInline: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
  },
  createInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 42,
    padding: 0,
  },
  createCreditCardButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 46,
  },
  currencyText: {
    fontSize: 18,
    fontWeight: '900',
  },
  fieldContent: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  fieldSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  fieldValue: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
    marginTop: 2,
  },
  glassCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255,255,255,0.10)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  headerSpacer: {
    width: 40,
  },
  iconBubble: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconBubbleText: {
    fontSize: 12,
    fontWeight: '900',
  },
  inlineInput: {
    fontSize: 18,
    fontWeight: '700',
    minHeight: 34,
    padding: 0,
  },
  installmentChip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 44,
    minWidth: 58,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  installmentChipText: {
    fontSize: 15,
    fontWeight: '900',
  },
  installmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestFreeCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
    padding: 12,
  },
  interestFreeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  modalOverlay: {
    backgroundColor: 'rgba(5, 4, 8, 0.78)',
    flex: 1,
  },
  optionDot: {
    borderRadius: 8,
    height: 16,
    width: 16,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
  optionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  optionTextBlock: {
    flex: 1,
  },
  paymentOption: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    paddingVertical: 9,
  },
  paymentSwitch: {
    borderRadius: 20,
    flexDirection: 'row',
    marginTop: 8,
    padding: 4,
  },
  paymentText: {
    fontSize: 14,
    fontWeight: '900',
  },
  pickerArrow: {
    fontSize: 24,
    fontWeight: '700',
  },
  pickerOption: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  pickerPanel: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 8,
  },
  pickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  primaryGlow: {
    backgroundColor: 'rgba(61, 90, 254, 0.14)',
    borderRadius: 160,
    height: 320,
    position: 'absolute',
    right: -120,
    top: 88,
    width: 320,
  },
  receiptButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  receiptText: {
    fontSize: 14,
    fontWeight: '900',
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 58,
    justifyContent: 'center',
    shadowColor: '#3d5afe',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  saveText: {
    fontSize: 22,
    fontWeight: '900',
  },
  sheet: {
    alignSelf: 'center',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    flex: 1,
    maxWidth: 560,
    width: '100%',
  },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '900',
  },
  switchKnob: {
    backgroundColor: '#f1f0ff',
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  switchKnobOn: {
    transform: [{ translateX: 18 }],
  },
  switchPill: {
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 42,
    padding: 3,
  },
  tertiaryGlow: {
    backgroundColor: 'rgba(0, 228, 117, 0.10)',
    borderRadius: 170,
    bottom: -90,
    height: 340,
    position: 'absolute',
    right: -110,
    width: 340,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
  },
  typeOption: {
    alignItems: 'center',
    borderRadius: 24,
    flex: 1,
    paddingVertical: 11,
  },
  typeSwitch: {
    borderRadius: 28,
    flexDirection: 'row',
    padding: 5,
  },
  typeText: {
    fontSize: 15,
    fontWeight: '900',
  },
});

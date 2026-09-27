import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SmartFinSQLiteDatabase } from '../../../database';
import type { AppTheme } from '../../settings';
import { useAiAssistantController } from '../hooks/useAiAssistantController';
import { useAiSpeechInput } from '../hooks/useAiSpeechInput';
import type {
  AiClarificationQuestion,
  AiCommandAction,
  AiPlanningContext,
} from '../types';
import { describeAiAction } from '../useCases';

type AiAssistantScreenProps = {
  activeTheme: AppTheme;
  database?: SmartFinSQLiteDatabase;
  onBack: () => void;
  onCommitted: () => void;
};

type Palette = {
  background: string;
  border: string;
  card: string;
  danger: string;
  inverse: string;
  muted: string;
  primary: string;
  primarySoft: string;
  success: string;
  text: string;
};

const palettes: Record<AppTheme, Palette> = {
  dark: {
    background: '#0a0a0b', border: 'rgba(255,255,255,0.13)', card: '#1a1a1d',
    danger: '#ffb4ab', inverse: '#001d93', muted: '#c5c5d9', primary: '#bbc3ff',
    primarySoft: 'rgba(187,195,255,0.14)', success: '#00e475', text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb', border: 'rgba(30,36,60,0.13)', card: '#ffffff',
    danger: '#a9362e', inverse: '#ffffff', muted: '#686678', primary: '#2848ee',
    primarySoft: 'rgba(40,72,238,0.10)', success: '#007f3e', text: '#18191f',
  },
};

export function AiAssistantScreen({
  activeTheme,
  database,
  onBack,
  onCommitted,
}: AiAssistantScreenProps) {
  const insets = useSafeAreaInsets();
  const palette = palettes[activeTheme];
  const controller = useAiAssistantController(database, onCommitted);
  const { setInput } = controller;
  const onTranscript = useCallback((text: string) => setInput(text), [setInput]);
  const speech = useAiSpeechInput(onTranscript);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderColor: palette.border, paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: palette.primary }]}>{'‹'}</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: palette.text }]}>Hablar con IA</Text>
          <Text style={[styles.headerSubtitle, { color: palette.muted }]}>Gemini interpreta; tú confirmas</Text>
        </View>
        <View style={[styles.aiBadge, { backgroundColor: palette.primarySoft }]}>
          <Text style={[styles.aiBadgeText, { color: palette.primary }]}>IA</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 160 }]}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.notice, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}>
          <Text style={[styles.noticeTitle, { color: palette.text }]}>Tus datos siguen bajo tu control</Text>
          <Text style={[styles.noticeText, { color: palette.muted }]}>
            Solo se envía el mensaje actual y nombres mínimos de tus catálogos. Nunca se envían saldos ni historial.
          </Text>
        </View>

        {controller.draft ? (
          <View style={[styles.userBubble, { backgroundColor: palette.primary }]}>
            <Text style={[styles.userBubbleText, { color: palette.inverse }]}>{controller.draft.rawInput}</Text>
          </View>
        ) : null}

        {controller.draft ? (
          <View style={[styles.assistantBubble, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.assistantLabel, { color: palette.primary }]}>SmartFin IA</Text>
            <Text style={[styles.assistantText, { color: palette.text }]}>{controller.draft.plan.summary}</Text>
          </View>
        ) : null}

        {controller.currentQuestion ? (
          <QuestionCard
            key={controller.currentQuestion.id}
            onAnswer={value => { controller.answerQuestion(controller.currentQuestion as AiClarificationQuestion, value); }}
            palette={palette}
            question={controller.currentQuestion}
            remaining={controller.questions.length}
          />
        ) : null}

        {controller.draft && controller.questions.length === 0 ? (
          <View style={[styles.reviewCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.reviewTitle, { color: palette.text }]}>Revisión final</Text>
            <Text style={[styles.reviewHint, { color: palette.muted }]}>Nada se guardará hasta que confirmes el lote completo.</Text>
            {controller.draft.plan.actions.map((action, index) => (
              <View key={action.id} style={[styles.reviewRow, { borderColor: palette.border }]}>
                <View style={[styles.reviewIndex, { backgroundColor: palette.primarySoft }]}>
                  <Text style={[styles.reviewIndexText, { color: palette.primary }]}>{index + 1}</Text>
                </View>
                <View style={styles.reviewCopy}>
                  <Text style={[styles.reviewText, { color: palette.text }]}>{describeAiAction(action)}</Text>
                  {describeActionDetails(action, controller.context).map(detail => (
                    <Text key={`${action.id}-${detail}`} style={[styles.reviewDetail, { color: palette.muted }]}>{detail}</Text>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.reviewActions}>
              <Pressable onPress={() => { controller.correctDraft(); }} style={[styles.secondaryButton, { borderColor: palette.border }]}>
                <Text style={[styles.secondaryButtonText, { color: palette.text }]}>Corregir texto</Text>
              </Pressable>
              <Pressable
                disabled={Boolean(controller.busyMessage)}
                onPress={() => { controller.confirm(); }}
                style={[styles.primaryButton, { backgroundColor: palette.primary }]}>
                <Text style={[styles.primaryButtonText, { color: palette.inverse }]}>Confirmar todo</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => { controller.cancelDraft(); }} style={styles.cancelButton}>
              <Text style={[styles.cancelText, { color: palette.danger }]}>Cancelar borrador</Text>
            </Pressable>
          </View>
        ) : null}

        {controller.resultMessages.length > 0 ? (
          <View style={[styles.resultCard, { backgroundColor: palette.card, borderColor: palette.success }]}>
            <Text style={[styles.resultTitle, { color: palette.success }]}>Operaciones guardadas</Text>
            {controller.resultMessages.map((message, index) => (
              <Text key={`${index}-${message}`} style={[styles.resultText, { color: palette.text }]}>• {message}</Text>
            ))}
          </View>
        ) : null}

        {controller.busyMessage ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={palette.primary} />
            <Text style={[styles.statusText, { color: palette.muted }]}>{controller.busyMessage}</Text>
          </View>
        ) : null}
        {controller.errorMessage || speech.error ? (
          <Text style={[styles.errorText, { color: palette.danger }]}>{controller.errorMessage ?? speech.error}</Text>
        ) : null}
      </ScrollView>

      {!controller.draft ? (
        <View style={[styles.composer, { backgroundColor: palette.background, borderColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            editable={!controller.busyMessage}
            multiline
            onChangeText={controller.setInput}
            placeholder="Ej.: pagué mercado y gasolina con mi Visa..."
            placeholderTextColor={palette.muted}
            style={[styles.input, { backgroundColor: palette.card, borderColor: palette.border, color: palette.text }]}
            value={controller.input}
          />
          <View style={styles.composerActions}>
            <Pressable
              accessibilityLabel={speech.listening ? 'Detener dictado' : 'Iniciar dictado'}
              accessibilityRole="button"
              onPress={() => { speech.toggleListening(); }}
              style={[styles.micButton, { backgroundColor: speech.listening ? palette.danger : palette.primarySoft }]}>
              <Text style={[styles.micText, { color: speech.listening ? palette.inverse : palette.primary }]}>{speech.listening ? '■' : '🎙'}</Text>
            </Pressable>
            <Pressable
              disabled={!controller.input.trim() || Boolean(controller.busyMessage)}
              onPress={() => { controller.submit(); }}
              style={[
                styles.sendButton,
                { backgroundColor: palette.primary },
                !controller.input.trim() || controller.busyMessage ? styles.disabled : null,
              ]}>
              <Text style={[styles.sendText, { color: palette.inverse }]}>Interpretar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function describeActionDetails(
  action: AiCommandAction,
  context?: AiPlanningContext,
): string[] {
  const fields = action.fields as Record<string, unknown>;
  const labels: Record<string, string> = {
    accountId: 'Cuenta', amount: 'Valor', annualEffectiveInterestRate: 'Tasa E.A.',
    bankName: 'Banco', categoryId: 'Categoría', closingDay: 'Día de corte',
    color: 'Color', creditLimit: 'Cupo', date: 'Fecha', description: 'Descripción',
    initialBalance: 'Saldo inicial', installmentCount: 'Cuotas', institutionName: 'Institución',
    interestFreeInstallmentCount: 'Cuotas sin interés', lastFourDigits: 'Últimos dígitos',
    managementFee: 'Cuota de manejo', name: 'Nombre', notes: 'Notas', paymentDay: 'Día de pago',
    recurringIncomeAmount: 'Ingreso recurrente', recurringIncomeDay: 'Día del ingreso',
    recurringIncomeEnabled: 'Ingreso recurrente', recurringIncomeFrequency: 'Frecuencia',
    recurringIncomeType: 'Tipo de ingreso', subcategoryId: 'Subcategoría',
    targetAccountId: 'Cuenta destino', transactionType: 'Tipo', transferTaxCharged: '4x1000',
    type: 'Tipo',
  };
  const hidden = new Set([
    'accountName', 'accountRef', 'categoryName', 'categoryRef', 'subcategoryName',
    'subcategoryRef', 'targetAccountName', 'targetAccountRef',
  ]);
  const resolveLabel = (field: string, value: unknown): string => {
    if (typeof value !== 'string' || !context) return String(value);
    if (field === 'accountId' || field === 'targetAccountId') {
      return context.accounts.find(item => item.id === value)?.name ?? value;
    }
    if (field === 'categoryId') return context.categories.find(item => item.id === value)?.name ?? value;
    if (field === 'subcategoryId') return context.subcategories.find(item => item.id === value)?.name ?? value;
    return value;
  };
  const details = Object.entries(fields)
    .filter(([field, value]) => !hidden.has(field) && value !== undefined && value !== null && value !== '')
    .map(([field, value]) => {
      let displayed = typeof value === 'boolean' ? (value ? 'Sí' : 'No') : resolveLabel(field, value);
      if (['amount', 'creditLimit', 'initialBalance', 'managementFee', 'recurringIncomeAmount'].includes(field) && typeof value === 'number') {
        displayed = `$${value.toLocaleString('es-CO')} COP`;
      } else if (field === 'date' && typeof value === 'string') {
        displayed = value.slice(0, 10);
      }
      return `${labels[field] ?? field}: ${displayed}`;
    });
  if (action.operation === 'delete') {
    details.push(action.entity === 'transaction'
      ? 'Borrado seguro: se revertirá el impacto en saldos y cuotas.'
      : 'Borrado seguro: se preservará el historial relacionado.');
  }
  return details;
}

function QuestionCard({
  onAnswer,
  palette,
  question,
  remaining,
}: {
  onAnswer: (value: string) => void;
  palette: Palette;
  question: AiClarificationQuestion;
  remaining: number;
}) {
  const [custom, setCustom] = useState('');
  return (
    <View style={[styles.questionCard, { backgroundColor: palette.card, borderColor: palette.primary }]}>
      <Text style={[styles.questionProgress, { color: palette.primary }]}>{remaining} pregunta{remaining === 1 ? '' : 's'} pendiente{remaining === 1 ? '' : 's'}</Text>
      <Text style={[styles.questionText, { color: palette.text }]}>{question.prompt}</Text>
      <View style={styles.optionList}>
        {question.options.map(item => (
          <Pressable key={`${question.id}-${item.value}`} onPress={() => onAnswer(item.value)} style={[styles.option, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}>
            <Text style={[styles.optionText, { color: palette.text }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {question.allowCustom ? (
        <View style={styles.customRow}>
          <TextInput
            keyboardType={question.valueType === 'number' ? 'decimal-pad' : 'default'}
            onChangeText={setCustom}
            placeholder={question.valueType === 'date' ? 'AAAA-MM-DD' : 'Otra respuesta'}
            placeholderTextColor={palette.muted}
            style={[styles.customInput, { borderColor: palette.border, color: palette.text }]}
            value={custom}
          />
          <Pressable disabled={!custom.trim()} onPress={() => onAnswer(custom)} style={[styles.customButton, { backgroundColor: palette.primary }, !custom.trim() ? styles.disabled : null]}>
            <Text style={[styles.customButtonText, { color: palette.inverse }]}>Aceptar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  aiBadge: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  aiBadgeText: { fontSize: 12, fontWeight: '900' },
  assistantBubble: { alignSelf: 'flex-start', borderRadius: 18, borderWidth: 1, gap: 5, maxWidth: '92%', padding: 14 },
  assistantLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  assistantText: { fontSize: 15, lineHeight: 21 },
  cancelButton: { alignItems: 'center', paddingTop: 4 },
  cancelText: { fontSize: 13, fontWeight: '800' },
  composer: { borderTopWidth: 1, bottom: 0, gap: 10, left: 0, paddingHorizontal: 16, paddingTop: 12, position: 'absolute', right: 0 },
  composerActions: { flexDirection: 'row', gap: 10 },
  content: { alignSelf: 'center', gap: 16, maxWidth: 620, padding: 16, width: '100%' },
  customButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 16 },
  customButtonText: { fontSize: 13, fontWeight: '900' },
  customInput: { borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 46, paddingHorizontal: 12 },
  customRow: { flexDirection: 'row', gap: 8 },
  disabled: { opacity: 0.45 },
  errorText: { fontSize: 13, fontWeight: '700', lineHeight: 19, textAlign: 'center' },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 72, paddingBottom: 10, paddingHorizontal: 12 },
  headerButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  headerButtonText: { fontSize: 36, fontWeight: '500', lineHeight: 38 },
  headerCopy: { flex: 1 },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  input: { borderRadius: 16, borderWidth: 1, fontSize: 15, maxHeight: 110, minHeight: 54, paddingHorizontal: 14, paddingVertical: 12 },
  micButton: { alignItems: 'center', borderRadius: 14, height: 48, justifyContent: 'center', width: 54 },
  micText: { fontSize: 18, fontWeight: '900' },
  notice: { borderRadius: 16, borderWidth: 1, gap: 5, padding: 14 },
  noticeText: { fontSize: 12, lineHeight: 18 },
  noticeTitle: { fontSize: 14, fontWeight: '900' },
  option: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  optionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionText: { fontSize: 13, fontWeight: '700' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  primaryButtonText: { fontSize: 13, fontWeight: '900' },
  questionCard: { borderRadius: 20, borderWidth: 1, gap: 14, padding: 16 },
  questionProgress: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  questionText: { fontSize: 19, fontWeight: '800', lineHeight: 26 },
  resultCard: { borderRadius: 18, borderWidth: 1, gap: 8, padding: 16 },
  resultText: { fontSize: 13, lineHeight: 19 },
  resultTitle: { fontSize: 17, fontWeight: '900' },
  reviewActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  reviewCard: { borderRadius: 20, borderWidth: 1, gap: 12, padding: 16 },
  reviewCopy: { flex: 1, gap: 3 },
  reviewDetail: { fontSize: 11, lineHeight: 16 },
  reviewHint: { fontSize: 12, lineHeight: 18 },
  reviewIndex: { alignItems: 'center', borderRadius: 13, height: 26, justifyContent: 'center', width: 26 },
  reviewIndexText: { fontSize: 12, fontWeight: '900' },
  reviewRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingBottom: 10 },
  reviewText: { flex: 1, fontSize: 14, fontWeight: '700' },
  reviewTitle: { fontSize: 20, fontWeight: '900' },
  screen: { flex: 1 },
  secondaryButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48 },
  secondaryButtonText: { fontSize: 13, fontWeight: '900' },
  sendButton: { alignItems: 'center', borderRadius: 14, flex: 1, height: 48, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '900' },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center' },
  statusText: { fontSize: 13, fontWeight: '700' },
  userBubble: { alignSelf: 'flex-end', borderRadius: 18, maxWidth: '88%', padding: 14 },
  userBubbleText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
});

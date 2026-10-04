import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
  AiClarificationExchange,
  AiCommandDraft,
  AiEditableField,
} from '../types';
import { buildEditableFields, describeAiAction, resolveNamedColor } from '../useCases';

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
  const currentQuestionId = controller.currentQuestion?.id;
  const scrollRef = useRef<ScrollView>(null);
  const { setInput } = controller;
  const onTranscript = useCallback((text: string) => setInput(text), [setInput]);
  const speech = useAiSpeechInput(onTranscript);
  const [questionsVisible, setQuestionsVisible] = useState(false);
  const [editingField, setEditingField] = useState<AiEditableField>();
  const sourceText = controller.draft ? [
    controller.draft.rawInput,
    ...controller.draft.messages.filter(message => message.role === 'user').map(message => message.text),
  ].join('\n') : '';
  const showComposer = !controller.draft || controller.isCorrectionComposerOpen;

  const revealActiveInput = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  }, []);

  useEffect(() => {
    if (!currentQuestionId) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [currentQuestionId]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[styles.content, { paddingBottom: showComposer ? 180 : Math.max(insets.bottom + 24, 32) }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled">
        <View style={[styles.notice, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}>
          <Text style={[styles.noticeTitle, { color: palette.text }]}>Tus datos siguen bajo tu control</Text>
          <Text style={[styles.noticeText, { color: palette.muted }]}>
            Al interpretar se envía tu mensaje y nombres mínimos de tus catálogos. Al corregir también se envían el borrador activo y sus respuestas. Nunca se envían saldos ni historial financiero.
          </Text>
        </View>

        {controller.draft ? <ConversationTimeline draft={controller.draft} palette={palette} /> : null}

        {controller.currentQuestion ? (
          <QuestionCard
            key={controller.currentQuestion.id}
            onAnswer={value => { controller.answerQuestion(controller.currentQuestion as AiClarificationQuestion, value); }}
            onCustomFocus={revealActiveInput}
            palette={palette}
            question={controller.currentQuestion}
            remaining={controller.questions.length}
          />
        ) : null}

        {controller.draft && controller.questions.length === 0 ? (
          <>
            <Pressable
              onPress={() => setQuestionsVisible(true)}
              style={[styles.questionsChip, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}>
              <Text style={[styles.questionsChipText, { color: palette.primary }]}>Preguntas ({controller.draft.clarificationHistory.length})</Text>
              <Text style={[styles.questionsChipArrow, { color: palette.muted }]}>Ver ›</Text>
            </Pressable>
            <View style={[styles.reviewCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.reviewTitle, { color: palette.text }]}>Revisión final</Text>
              <Text style={[styles.reviewHint, { color: palette.muted }]}>Toca cualquier valor para editarlo. Nada se guardará hasta que confirmes el lote completo.</Text>
              {controller.draft.plan.actions.map((action, index) => (
                <View key={action.id} style={[styles.reviewRow, { borderColor: palette.border }]}>
                  <View style={[styles.reviewIndex, { backgroundColor: palette.primarySoft }]}>
                    <Text style={[styles.reviewIndexText, { color: palette.primary }]}>{index + 1}</Text>
                  </View>
                  <View style={styles.reviewCopy}>
                    <Text style={[styles.reviewText, { color: palette.text }]}>{describeAiAction(action)}</Text>
                    {controller.context ? buildEditableFields(action, controller.draft!.plan, controller.context, sourceText).map(field => (
                      <EditableReviewValue
                        field={field}
                        key={`${action.id}-${field.field}`}
                        onPress={() => setEditingField(field)}
                        palette={palette}
                      />
                    )) : null}
                  </View>
                </View>
              ))}
              <View style={styles.reviewActions}>
                <Pressable onPress={() => { controller.correctDraft(); }} style={[styles.secondaryButton, { borderColor: palette.border }]}>
                  <Text style={[styles.secondaryButtonText, { color: palette.text }]}>Responder/Corregir</Text>
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
          </>
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

      {showComposer ? (
        <View style={[styles.composer, { backgroundColor: palette.background, borderColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            editable={!controller.busyMessage}
            multiline
            onChangeText={controller.setInput}
            placeholder={controller.draft ? 'Ej.: cambia la fecha o el importe de esta solicitud...' : 'Ej.: crea una suscripción de Netflix por 44.900 cada mes...'}
            placeholderTextColor={palette.muted}
            style={[styles.input, { backgroundColor: palette.card, borderColor: palette.border, color: palette.text }]}
            value={controller.input}
          />
          <View style={styles.composerActions}>
            {controller.draft ? (
              <Pressable onPress={controller.closeCorrection} style={[styles.composerCancelButton, { borderColor: palette.border }]}>
                <Text style={[styles.secondaryButtonText, { color: palette.text }]}>Cancelar</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={speech.listening ? 'Detener dictado' : 'Iniciar dictado'}
              accessibilityRole="button"
              onPress={() => { speech.toggleListening(); }}
              style={[styles.micButton, { backgroundColor: speech.listening ? palette.danger : palette.primarySoft }]}>
              <Text style={[styles.micText, { color: speech.listening ? palette.inverse : palette.primary }]}>{speech.listening ? '■' : '🎙'}</Text>
            </Pressable>
            <Pressable
              disabled={!controller.input.trim() || Boolean(controller.busyMessage)}
              onPress={() => { controller.draft ? controller.reviseDraft() : controller.submit(); }}
              style={[
                styles.sendButton,
                { backgroundColor: palette.primary },
                !controller.input.trim() || controller.busyMessage ? styles.disabled : null,
              ]}>
              <Text style={[styles.sendText, { color: palette.inverse }]}>{controller.draft ? 'Enviar corrección' : 'Interpretar'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {controller.draft ? (
        <QuestionsModal
          history={controller.draft.clarificationHistory}
          onClose={() => setQuestionsVisible(false)}
          palette={palette}
          visible={questionsVisible}
        />
      ) : null}
      {editingField ? (
        <EditFieldModal
          field={editingField}
          onClose={() => setEditingField(undefined)}
          onSave={async value => {
            await controller.editField(editingField, value);
            setEditingField(undefined);
          }}
          palette={palette}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ConversationTimeline({ draft, palette }: { draft: AiCommandDraft; palette: Palette }) {
  const timeline = [
    ...draft.messages.map(message => ({ createdAt: message.createdAt, id: message.id, kind: 'message' as const, message })),
    ...draft.clarificationHistory.map(exchange => ({ createdAt: exchange.answeredAt, id: exchange.id, kind: 'exchange' as const, exchange })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return <>
    {timeline.map(item => item.kind === 'message' ? (
      <View
        key={item.id}
        style={item.message.role === 'user'
          ? [styles.userBubble, { backgroundColor: palette.primary }]
          : [styles.assistantBubble, { backgroundColor: palette.card, borderColor: palette.border }]}>
        {item.message.role === 'assistant' ? <Text style={[styles.assistantLabel, { color: palette.primary }]}>SmartFin IA</Text> : null}
        <Text style={item.message.role === 'user'
          ? [styles.userBubbleText, { color: palette.inverse }]
          : [styles.assistantText, { color: palette.text }]}>{item.message.text}</Text>
      </View>
    ) : (
      <View key={item.id} style={[styles.exchangeCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Text style={[styles.exchangeContext, { color: palette.primary }]}>{item.exchange.contextLabel}</Text>
        <Text style={[styles.exchangeQuestion, { color: palette.muted }]}>{item.exchange.prompt}</Text>
        <Text style={[styles.exchangeAnswer, { color: palette.text }]}>Tu respuesta: {item.exchange.answerLabel}</Text>
      </View>
    ))}
  </>;
}

function QuestionsModal({ history, onClose, palette, visible }: {
  history: AiClarificationExchange[];
  onClose: () => void;
  palette: Palette;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={[styles.modalTitle, { color: palette.text }]}>Preguntas</Text>
              <Text style={[styles.modalSubtitle, { color: palette.muted }]}>Lo que SmartFin preguntó y lo que respondiste</Text>
            </View>
            <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={styles.modalClose}>
              <Text style={[styles.modalCloseText, { color: palette.muted }]}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.historyList}>
            {history.length === 0 ? <Text style={[styles.emptyHistory, { color: palette.muted }]}>La IA no necesitó hacer preguntas para este borrador.</Text> : null}
            {history.map((exchange, index) => (
              <View key={exchange.id} style={[styles.historyRow, { borderColor: palette.border }]}>
                <Text style={[styles.historyIndex, { color: palette.primary }]}>{index + 1}. {exchange.contextLabel}</Text>
                <Text style={[styles.historyQuestion, { color: palette.text }]}>{exchange.prompt}</Text>
                <Text style={[styles.historyAnswer, { color: palette.muted }]}>Respuesta: {exchange.answerLabel}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatEditableValue(field: AiEditableField): string {
  const selected = field.options.find(optionItem => optionItem.value === field.value);
  if (selected) return selected.label;
  if (field.value === '__none__' || field.value === '') return 'No aplica';
  if (['amount', 'creditLimit', 'initialBalance', 'managementFee', 'recurringIncomeAmount'].includes(field.field)) {
    const amount = Number(field.value);
    if (Number.isFinite(amount)) return `$${amount.toLocaleString('es-CO')} COP`;
  }
  if (field.field === 'date') return field.value.slice(0, 10);
  return field.value;
}

function EditableReviewValue({ field, onPress, palette }: {
  field: AiEditableField;
  onPress: () => void;
  palette: Palette;
}) {
  const color = field.field === 'color' ? resolveNamedColor(field.value) : undefined;
  return (
    <Pressable onPress={onPress} style={[styles.editableValue, { borderColor: palette.border }]}>
      <View style={styles.editableValueCopy}>
        <Text style={[styles.editableLabel, { color: palette.muted }]}>{field.label}</Text>
        <View style={styles.editableValueLine}>
          {color ? <View style={[styles.colorSwatch, { backgroundColor: color, borderColor: palette.border }]} /> : null}
          <Text style={[styles.editableText, { color: palette.text }]}>{formatEditableValue(field)}</Text>
        </View>
      </View>
      <Text style={[styles.editIcon, { color: palette.primary }]}>Editar</Text>
    </Pressable>
  );
}

function EditFieldModal({ field, onClose, onSave, palette }: {
  field: AiEditableField;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
  palette: Palette;
}) {
  const initial = field.value === '__none__' ? '' : field.field === 'date' ? field.value.slice(0, 10) : field.value;
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const previewColor = field.field === 'color' ? resolveNamedColor(value) : undefined;
  const save = async () => {
    if (!value.trim() && !field.options.some(item => item.value === '__none__')) return;
    setSaving(true);
    setLocalError(undefined);
    try {
      await onSave(value.trim() || '__none__');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo guardar el valor.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.modalBackdrop}>
        <View style={[styles.editModal, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>Editar {field.label}</Text>
            <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={styles.modalClose}>
              <Text style={[styles.modalCloseText, { color: palette.muted }]}>×</Text>
            </Pressable>
          </View>
          {field.options.length > 0 ? (
            <ScrollView horizontal={false} style={styles.editOptionsScroll}>
              <View style={styles.optionList}>
                {field.options.map(item => (
                  <Pressable
                    key={`${field.field}-${item.value}-${item.label}`}
                    onPress={() => setValue(item.value)}
                    style={[styles.option, { backgroundColor: value === item.value ? palette.primarySoft : 'transparent', borderColor: value === item.value ? palette.primary : palette.border }]}>
                    {field.field === 'color' && item.value !== '__none__' ? <View style={[styles.colorSwatch, { backgroundColor: item.value, borderColor: palette.border }]} /> : null}
                    <Text style={[styles.optionText, { color: palette.text }]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : null}
          {field.allowCustom ? (
            <View style={styles.editInputRow}>
              {previewColor ? <View style={[styles.largeColorSwatch, { backgroundColor: previewColor, borderColor: palette.border }]} /> : null}
              <TextInput
                keyboardType={field.valueType === 'number' ? 'decimal-pad' : 'default'}
                onChangeText={setValue}
                placeholder={field.field === 'color' ? 'Ej.: azul, morado o #3b82f6' : field.valueType === 'date' ? 'AAAA-MM-DD' : 'Nuevo valor'}
                placeholderTextColor={palette.muted}
                style={[styles.editInput, { borderColor: palette.border, color: palette.text }]}
                value={value === '__none__' ? '' : value}
              />
            </View>
          ) : null}
          {localError ? <Text style={[styles.errorText, { color: palette.danger }]}>{localError}</Text> : null}
          <View style={styles.reviewActions}>
            <Pressable onPress={onClose} style={[styles.secondaryButton, { borderColor: palette.border }]}>
              <Text style={[styles.secondaryButtonText, { color: palette.text }]}>Cancelar</Text>
            </Pressable>
            <Pressable disabled={saving || (!value.trim() && !field.options.some(item => item.value === '__none__'))} onPress={save} style={[styles.primaryButton, { backgroundColor: palette.primary }, saving ? styles.disabled : null]}>
              <Text style={[styles.primaryButtonText, { color: palette.inverse }]}>{saving ? 'Guardando...' : 'Guardar'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QuestionCard({
  onAnswer,
  onCustomFocus,
  palette,
  question,
  remaining,
}: {
  onAnswer: (value: string) => void;
  onCustomFocus: () => void;
  palette: Palette;
  question: AiClarificationQuestion;
  remaining: number;
}) {
  const [custom, setCustom] = useState('');
  const customColor = question.field === 'color' ? resolveNamedColor(custom) : undefined;
  return (
    <View style={[styles.questionCard, { backgroundColor: palette.card, borderColor: palette.primary }]}>
      <Text style={[styles.questionProgress, { color: palette.primary }]}>{remaining} pregunta{remaining === 1 ? '' : 's'} pendiente{remaining === 1 ? '' : 's'}</Text>
      <Text style={[styles.questionContext, { color: palette.muted }]}>{question.contextLabel}</Text>
      <Text style={[styles.questionText, { color: palette.text }]}>{question.prompt}</Text>
      {question.helpText ? <Text style={[styles.questionHelp, { color: palette.muted }]}>{question.helpText}</Text> : null}
      <View style={styles.optionList}>
        {question.options.map(item => (
          <Pressable key={`${question.id}-${item.value}-${item.label}`} onPress={() => onAnswer(item.value)} style={[styles.option, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}>
            {question.field === 'color' && item.value !== '__none__' ? <View style={[styles.colorSwatch, { backgroundColor: item.value, borderColor: palette.border }]} /> : null}
            <Text style={[styles.optionText, { color: palette.text }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {question.allowCustom ? (
        <View style={styles.customRow}>
          {customColor ? <View style={[styles.largeColorSwatch, { backgroundColor: customColor, borderColor: palette.border }]} /> : null}
          <TextInput
            keyboardType={question.valueType === 'number' ? 'decimal-pad' : 'default'}
            onChangeText={setCustom}
            onFocus={onCustomFocus}
            placeholder={question.valueType === 'date'
              ? 'AAAA-MM-DD'
              : question.field === 'accountId' || question.field === 'categoryId' || question.field === 'subcategoryId'
                ? 'Nombre existente o nuevo'
                : 'Otra respuesta'}
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
  colorSwatch: { borderRadius: 8, borderWidth: 1, height: 16, width: 16 },
  composer: { borderTopWidth: 1, bottom: 0, gap: 10, left: 0, paddingHorizontal: 16, paddingTop: 12, position: 'absolute', right: 0 },
  composerActions: { flexDirection: 'row', gap: 10 },
  composerCancelButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, height: 48, justifyContent: 'center', paddingHorizontal: 16 },
  content: { alignSelf: 'center', gap: 16, maxWidth: 620, padding: 16, width: '100%' },
  customButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 16 },
  customButtonText: { fontSize: 13, fontWeight: '900' },
  customInput: { borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 46, paddingHorizontal: 12 },
  customRow: { flexDirection: 'row', gap: 8 },
  disabled: { opacity: 0.45 },
  editableLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  editableText: { flex: 1, fontSize: 12, fontWeight: '700' },
  editableValue: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'space-between', minHeight: 48, paddingVertical: 7 },
  editableValueCopy: { flex: 1, gap: 3 },
  editableValueLine: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  editIcon: { fontSize: 11, fontWeight: '900' },
  editInput: { borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 48, paddingHorizontal: 12 },
  editInputRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  editModal: { borderRadius: 22, borderWidth: 1, gap: 16, maxHeight: '82%', maxWidth: 560, padding: 18, width: '92%' },
  editOptionsScroll: { maxHeight: 230 },
  emptyHistory: { fontSize: 13, lineHeight: 19, paddingVertical: 18, textAlign: 'center' },
  errorText: { fontSize: 13, fontWeight: '700', lineHeight: 19, textAlign: 'center' },
  exchangeAnswer: { fontSize: 13, fontWeight: '800' },
  exchangeCard: { alignSelf: 'stretch', borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
  exchangeContext: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
  exchangeQuestion: { fontSize: 12, lineHeight: 17 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 72, paddingBottom: 10, paddingHorizontal: 12 },
  headerButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  headerButtonText: { fontSize: 36, fontWeight: '500', lineHeight: 38 },
  headerCopy: { flex: 1 },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  input: { borderRadius: 16, borderWidth: 1, fontSize: 15, maxHeight: 110, minHeight: 54, paddingHorizontal: 14, paddingVertical: 12 },
  historyAnswer: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  historyIndex: { fontSize: 11, fontWeight: '900' },
  historyList: { gap: 4, paddingBottom: 18 },
  historyQuestion: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  historyRow: { borderBottomWidth: 1, gap: 5, paddingVertical: 12 },
  largeColorSwatch: { borderRadius: 12, borderWidth: 1, height: 38, width: 38 },
  micButton: { alignItems: 'center', borderRadius: 14, height: 48, justifyContent: 'center', width: 54 },
  micText: { fontSize: 18, fontWeight: '900' },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'center', padding: 16 },
  modalClose: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  modalCloseText: { fontSize: 30, lineHeight: 32 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalSheet: { borderRadius: 22, borderWidth: 1, maxHeight: '82%', maxWidth: 560, padding: 18, width: '92%' },
  modalSubtitle: { fontSize: 11, marginTop: 3 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  notice: { borderRadius: 16, borderWidth: 1, gap: 5, padding: 14 },
  noticeText: { fontSize: 12, lineHeight: 18 },
  noticeTitle: { fontSize: 14, fontWeight: '900' },
  option: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 12, paddingVertical: 10 },
  optionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionText: { fontSize: 13, fontWeight: '700' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  primaryButtonText: { fontSize: 13, fontWeight: '900' },
  questionCard: { borderRadius: 20, borderWidth: 1, gap: 14, padding: 16 },
  questionContext: { fontSize: 12, fontWeight: '800' },
  questionHelp: { fontSize: 12, lineHeight: 18 },
  questionProgress: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  questionText: { fontSize: 19, fontWeight: '800', lineHeight: 26 },
  questionsChip: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 14, paddingHorizontal: 13, paddingVertical: 9 },
  questionsChipArrow: { fontSize: 11, fontWeight: '800' },
  questionsChipText: { fontSize: 12, fontWeight: '900' },
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

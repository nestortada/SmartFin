import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database';
import { getFinancialDataRevision } from '../../../database/sqliteDatabase';
import { withDatabaseMaintenance } from '../../../database/databaseCoordination';
import { borrowSQLiteDatabase } from '../../../database/managedSQLite';
import { SQLiteCommandFailure } from '../../../database/atomicSQLite';
import { saveAiDraftForReview } from '../repositories/sqliteAiDraftRepository';
import { createGeminiCommandService } from '../../../services';
import { createSqliteAccountRepository } from '../../accounts';
import { createSqliteCategoryRepository, createSqliteSubcategoryRepository } from '../../categories';
import {
  createSqliteAiDraftRepository,
  createSqliteTransactionRepository,
} from '../repositories';
import type {
  AiClarificationQuestion,
  AiCommandDraft,
  AiPlanningContext,
} from '../types';
import {
  applyClarificationAnswer,
  buildClarificationQuestions,
  executeAiCommandPlan,
  normalizeAiCommandPlan,
  updateAiActionField,
} from '../useCases';
import type { AiEditableField } from '../types';

type ReviewContext = AiPlanningContext & { financialRevision: number };
async function loadContext(database: SmartFinSQLiteDatabase): Promise<ReviewContext> {
  return withDatabaseMaintenance(async permit => {
  const owned = borrowSQLiteDatabase(database, permit);
  const [accounts, categories, subcategories, transactions] = await Promise.all([
    createSqliteAccountRepository(owned).getAccounts(),
    createSqliteCategoryRepository(owned).getCategories(),
    createSqliteSubcategoryRepository(owned).getSubcategories(),
    createSqliteTransactionRepository(owned).getTransactions(),
  ]);
  return { accounts, categories, subcategories, transactions, financialRevision: await getFinancialDataRevision(owned) };
  });
}

function preserveAnsweredValues(current: AiCommandDraft['plan'], revised: AiCommandDraft['plan']): void {
  const aliases: Record<string, string[]> = {
    accountId: ['accountRef', 'accountName', 'pendingAccountName', 'pendingAccountKind'],
    categoryId: ['categoryRef', 'categoryName'],
    subcategoryId: ['subcategoryRef', 'subcategoryName'],
    targetAccountId: ['targetAccountRef', 'targetAccountName'],
  };
  const revisedIds = new Set(revised.actions.map(action => action.id));
  revised.answeredFields = current.answeredFields.filter(answered => revisedIds.has(answered.split('.')[0] ?? ''));
  for (const answered of revised.answeredFields) {
    const separator = answered.indexOf('.');
    if (separator < 1) continue;
    const actionId = answered.slice(0, separator);
    const field = answered.slice(separator + 1);
    const oldAction = current.actions.find(action => action.id === actionId);
    const newAction = revised.actions.find(action => action.id === actionId);
    if (!oldAction || !newAction || oldAction.entity !== newAction.entity) continue;
    if (field === 'targetId') {
      if (newAction.targetId === undefined) newAction.targetId = oldAction.targetId;
      continue;
    }
    const oldFields = oldAction.fields as Record<string, unknown>;
    const newFields = newAction.fields as Record<string, unknown>;
    if (newFields[field] === undefined) newFields[field] = oldFields[field];
    for (const alias of aliases[field] ?? []) {
      if (newFields[alias] === undefined) newFields[alias] = oldFields[alias];
    }
  }
}

export function useAiAssistantController(
  database: SmartFinSQLiteDatabase | undefined,
  onCommitted: () => void,
) {
  const confirmationActive = useRef(false);
  const [busyMessage, setBusyMessage] = useState<string>();
  const [context, setContext] = useState<ReviewContext>();
  const [draft, setDraft] = useState<AiCommandDraft>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [input, setInput] = useState('');
  const [isCorrectionComposerOpen, setCorrectionComposerOpen] = useState(false);
  const [resultMessages, setResultMessages] = useState<string[]>([]);

  const conversationSource = useMemo(() => [
    draft?.rawInput ?? '',
    ...(draft?.messages.filter(message => message.role === 'user').map(message => message.text) ?? []),
    ...(draft?.clarificationHistory.map(exchange => exchange.answerValue) ?? []),
  ].join('\n'), [draft]);

  const questions = useMemo(
    () => draft && context ? buildClarificationQuestions(draft.plan, context, conversationSource) : [],
    [context, conversationSource, draft],
  );
  const currentQuestion = questions[0];

  const persistDraft = useCallback(async (next: AiCommandDraft) => {
    if (!database) return;
    await saveAiDraftForReview(database, next, context?.financialRevision);
    setDraft(next);
  }, [context, database]);

  useEffect(() => {
    let mounted = true;
    if (!database) return () => { mounted = false; };
    Promise.all([
      loadContext(database),
      createSqliteAiDraftRepository(database).loadActiveDraft(),
    ]).then(([nextContext, savedDraft]) => {
      if (!mounted) return;
      setContext(nextContext);
      if (savedDraft) {
        const createdAt = savedDraft.createdAt;
        const messages = savedDraft.messages.length > 0 ? savedDraft.messages : [
          { createdAt, id: `${savedDraft.id}-user`, role: 'user' as const, text: savedDraft.rawInput },
          { createdAt, id: `${savedDraft.id}-assistant`, role: 'assistant' as const, text: savedDraft.plan.summary },
        ];
        setDraft({ ...savedDraft, messages, plan: normalizeAiCommandPlan(savedDraft.plan, nextContext) });
        setInput('');
      }
    }).catch(error => {
      if (mounted) setErrorMessage(error instanceof Error ? error.message : 'No se pudo abrir el asistente.');
    });
    return () => { mounted = false; };
  }, [database]);

  const submit = useCallback(async () => {
    if (confirmationActive.current) return;
    if (!database) {
      setErrorMessage('La base de datos local aun no esta lista.');
      return;
    }
    setBusyMessage('Gemini esta interpretando tu solicitud...');
    setErrorMessage(undefined);
    setResultMessages([]);
    try {
      const nextContext = await loadContext(database);
      const interpreted = await createGeminiCommandService().interpret({
        catalog: nextContext,
        now: new Date(),
        text: input,
        timeZone: 'America/Bogota',
      });
      const plan = normalizeAiCommandPlan(interpreted, nextContext);
      const now = new Date().toISOString();
      const nextDraft: AiCommandDraft = {
        clarificationHistory: [],
        createdAt: now,
        id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        messages: [
          { createdAt: now, id: `message-${Date.now()}-user`, role: 'user', text: input.trim() },
          { createdAt: now, id: `message-${Date.now()}-assistant`, role: 'assistant', text: plan.summary },
        ],
        phase: buildClarificationQuestions(plan, nextContext, input).length > 0 ? 'clarifying' : 'review',
        plan,
        rawInput: input.trim(),
        updatedAt: now,
      };
      setContext(nextContext);
      await saveAiDraftForReview(database, nextDraft, nextContext.financialRevision);
      setDraft(nextDraft);
      setInput('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo interpretar la solicitud.');
    } finally {
      setBusyMessage(undefined);
    }
  }, [database, input]);

  const answerQuestion = useCallback(async (
    question: AiClarificationQuestion,
    value: string,
  ) => {
    if (!draft || !context || confirmationActive.current) return;
    setErrorMessage(undefined);
    try {
      const plan = normalizeAiCommandPlan(
        applyClarificationAnswer(draft.plan, question, value, context),
        context,
      );
      const selected = question.options.find(optionItem => optionItem.value === value);
      const answeredAt = new Date().toISOString();
      const nextSource = `${conversationSource}\n${value}`;
      await persistDraft({
        ...draft,
        clarificationHistory: [...draft.clarificationHistory, {
          actionId: question.actionId,
          answerLabel: selected?.label ?? value.trim(),
          answerValue: value.trim(),
          answeredAt,
          contextLabel: question.contextLabel,
          field: question.field,
          id: `${question.id}-${Date.now().toString(36)}`,
          prompt: question.prompt,
        }],
        phase: buildClarificationQuestions(plan, context, nextSource).length > 0 ? 'clarifying' : 'review',
        plan,
        updatedAt: answeredAt,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'La respuesta no es valida.');
    }
  }, [context, conversationSource, draft, persistDraft]);

  const cancelDraft = useCallback(async () => {
    if (confirmationActive.current) return;
    if (database) await createSqliteAiDraftRepository(database).clearActiveDraft();
    setDraft(undefined);
    setInput('');
    setCorrectionComposerOpen(false);
    setErrorMessage(undefined);
  }, [database]);

  const correctDraft = useCallback(() => {
    if (confirmationActive.current) return;
    setInput('');
    setErrorMessage(undefined);
    setCorrectionComposerOpen(true);
  }, []);

  const closeCorrection = useCallback(() => {
    setInput('');
    setCorrectionComposerOpen(false);
  }, []);

  const reviseDraft = useCallback(async () => {
    if (!database || !draft || !context || !input.trim() || confirmationActive.current) return;
    setBusyMessage('Gemini está revisando el borrador con el contexto anterior...');
    setErrorMessage(undefined);
    try {
      const correction = input.trim();
      const revised = await createGeminiCommandService().revise({
        catalog: context,
        clarificationHistory: draft.clarificationHistory,
        correction,
        currentPlan: draft.plan,
        now: new Date(),
        text: correction,
        timeZone: 'America/Bogota',
      });
      preserveAnsweredValues(draft.plan, revised);
      const plan = normalizeAiCommandPlan(revised, context);
      const updatedAt = new Date().toISOString();
      const messages = [
        ...draft.messages,
        { createdAt: updatedAt, id: `message-${Date.now()}-correction`, role: 'user' as const, text: correction },
        { createdAt: updatedAt, id: `message-${Date.now()}-revision`, role: 'assistant' as const, text: plan.summary },
      ];
      const nextSource = `${conversationSource}\n${correction}`;
      await persistDraft({
        ...draft,
        messages,
        phase: buildClarificationQuestions(plan, context, nextSource).length > 0 ? 'clarifying' : 'review',
        plan,
        updatedAt,
      });
      setInput('');
      setCorrectionComposerOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo corregir el borrador.');
    } finally {
      setBusyMessage(undefined);
    }
  }, [context, conversationSource, database, draft, input, persistDraft]);

  const editField = useCallback(async (field: AiEditableField, value: string) => {
    if (!draft || !context || confirmationActive.current) return;
    setErrorMessage(undefined);
    try {
      const plan = normalizeAiCommandPlan(updateAiActionField(draft.plan, field, value, context), context);
      await persistDraft({
        ...draft,
        phase: buildClarificationQuestions(plan, context, conversationSource).length > 0 ? 'clarifying' : 'review',
        plan,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo editar el valor.');
      throw error;
    }
  }, [context, conversationSource, draft, persistDraft]);

  const confirm = useCallback(async () => {
    if (!database || !draft || !context || confirmationActive.current) return;
    const plan = normalizeAiCommandPlan(draft.plan, context);
    const remainingQuestions = buildClarificationQuestions(plan, context, conversationSource);
    if (remainingQuestions.length > 0) {
      await persistDraft({
        ...draft,
        phase: 'clarifying',
        plan,
        updatedAt: new Date().toISOString(),
      });
      setErrorMessage('Responde todas las preguntas antes de confirmar.');
      return;
    }
    setBusyMessage('Guardando todas las operaciones...');
    confirmationActive.current = true;
    setErrorMessage(undefined);
    try {
      const result = await executeAiCommandPlan(database, draft.id, plan);
      setDraft(undefined);
      setInput('');
      setCorrectionComposerOpen(false);
      setResultMessages(result.completed);
      try {
        onCommitted();
        setContext(await loadContext(database));
      } catch {
        setErrorMessage('Operaciones guardadas. No se pudo actualizar la vista; vuelve a abrirla.');
      }
      confirmationActive.current = false;
    } catch (error) {
      if (!(error instanceof SQLiteCommandFailure && error.result.status === 'unknown'))
        confirmationActive.current = false;
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo verificar el resultado del lote.');
    } finally {
      setBusyMessage(undefined);
    }
  }, [context, conversationSource, database, draft, onCommitted, persistDraft]);

  return {
    answerQuestion,
    busyMessage,
    cancelDraft,
    closeCorrection,
    confirm,
    context,
    correctDraft,
    currentQuestion,
    draft,
    editField,
    errorMessage,
    input,
    isCorrectionComposerOpen,
    questions,
    resultMessages,
    reviseDraft,
    setInput,
    submit,
  };
}

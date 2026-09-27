import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database';
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
} from '../useCases';

async function loadContext(database: SmartFinSQLiteDatabase): Promise<AiPlanningContext> {
  const [accounts, categories, subcategories, transactions] = await Promise.all([
    createSqliteAccountRepository(database).getAccounts(),
    createSqliteCategoryRepository(database).getCategories(),
    createSqliteSubcategoryRepository(database).getSubcategories(),
    createSqliteTransactionRepository(database).getTransactions(),
  ]);
  return { accounts, categories, subcategories, transactions };
}

export function useAiAssistantController(
  database: SmartFinSQLiteDatabase | undefined,
  onCommitted: () => void,
) {
  const [busyMessage, setBusyMessage] = useState<string>();
  const [context, setContext] = useState<AiPlanningContext>();
  const [draft, setDraft] = useState<AiCommandDraft>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [input, setInput] = useState('');
  const [resultMessages, setResultMessages] = useState<string[]>([]);

  const questions = useMemo(
    () => draft && context ? buildClarificationQuestions(draft.plan, context) : [],
    [context, draft],
  );
  const currentQuestion = questions[0];

  const persistDraft = useCallback(async (next: AiCommandDraft) => {
    if (!database) return;
    await createSqliteAiDraftRepository(database).saveActiveDraft(next);
    setDraft(next);
  }, [database]);

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
        setDraft({ ...savedDraft, plan: normalizeAiCommandPlan(savedDraft.plan, nextContext) });
        setInput(savedDraft.rawInput);
      }
    }).catch(error => {
      if (mounted) setErrorMessage(error instanceof Error ? error.message : 'No se pudo abrir el asistente.');
    });
    return () => { mounted = false; };
  }, [database]);

  const submit = useCallback(async () => {
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
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota',
      });
      const plan = normalizeAiCommandPlan(interpreted, nextContext);
      const now = new Date().toISOString();
      const nextDraft: AiCommandDraft = {
        createdAt: now,
        id: `ai-${Date.now().toString(36)}`,
        phase: buildClarificationQuestions(plan, nextContext).length > 0 ? 'clarifying' : 'review',
        plan,
        rawInput: input.trim(),
        updatedAt: now,
      };
      setContext(nextContext);
      await persistDraft(nextDraft);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo interpretar la solicitud.');
    } finally {
      setBusyMessage(undefined);
    }
  }, [database, input, persistDraft]);

  const answerQuestion = useCallback(async (
    question: AiClarificationQuestion,
    value: string,
  ) => {
    if (!draft || !context) return;
    setErrorMessage(undefined);
    try {
      const plan = normalizeAiCommandPlan(
        applyClarificationAnswer(draft.plan, question, value),
        context,
      );
      await persistDraft({
        ...draft,
        phase: buildClarificationQuestions(plan, context).length > 0 ? 'clarifying' : 'review',
        plan,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'La respuesta no es valida.');
    }
  }, [context, draft, persistDraft]);

  const cancelDraft = useCallback(async () => {
    if (database) await createSqliteAiDraftRepository(database).clearActiveDraft();
    setDraft(undefined);
    setInput('');
    setErrorMessage(undefined);
  }, [database]);

  const correctDraft = useCallback(async () => {
    if (database) await createSqliteAiDraftRepository(database).clearActiveDraft();
    setDraft(undefined);
    setErrorMessage(undefined);
  }, [database]);

  const confirm = useCallback(async () => {
    if (!database || !draft || !context) return;
    if (questions.length > 0) {
      setErrorMessage('Responde todas las preguntas antes de confirmar.');
      return;
    }
    setBusyMessage('Guardando todas las operaciones...');
    setErrorMessage(undefined);
    try {
      const result = await executeAiCommandPlan(database, draft.id, draft.plan);
      await createSqliteAiDraftRepository(database).clearActiveDraft();
      setDraft(undefined);
      setInput('');
      setResultMessages(result.completed);
      setContext(await loadContext(database));
      onCommitted();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar el lote. No se aplico ningun cambio.');
    } finally {
      setBusyMessage(undefined);
    }
  }, [context, database, draft, onCommitted, questions.length]);

  return {
    answerQuestion,
    busyMessage,
    cancelDraft,
    confirm,
    context,
    correctDraft,
    currentQuestion,
    draft,
    errorMessage,
    input,
    questions,
    resultMessages,
    setInput,
    submit,
  };
}

import Config from 'react-native-config';

import type { Account } from '../modules/accounts';
import type { Category, Subcategory } from '../modules/categories';
import { parseAiCommandPlan } from '../modules/transactions/useCases/aiCommandPlanner';
import type { AiCommandPlan } from '../modules/transactions/types';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const MAX_INPUT_CHARACTERS = 4000;

export type GeminiCatalog = {
  accounts: Account[];
  categories: Category[];
  subcategories: Subcategory[];
};

export type GeminiInterpretationInput = {
  catalog: GeminiCatalog;
  now: Date;
  text: string;
  timeZone: string;
};

type GeminiServiceOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const responseSchema = {
  type: 'object',
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string' },
    actions: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['id', 'operation', 'entity', 'fieldsJson'],
        properties: {
          id: { type: 'string' },
          clientRef: { type: 'string' },
          operation: { type: 'string', enum: ['create', 'update', 'delete'] },
          entity: { type: 'string', enum: ['transaction', 'debitAccount', 'creditCard', 'category', 'subcategory'] },
          targetId: { type: 'string' },
          targetName: { type: 'string' },
          fieldsJson: {
            type: 'string',
            description: 'Objeto JSON serializado con los campos conocidos de la accion. Omite datos desconocidos.',
          },
        },
      },
    },
  },
} as const;

export function buildGeminiPrompt(input: GeminiInterpretationInput): string {
  const accounts = input.catalog.accounts
    .filter(account => account.status === 'active')
    .map(account => [account.id, account.name, account.type, account.institutionName ?? '']);
  const categories = input.catalog.categories.map(category => [category.id, category.name, category.type]);
  const subcategories = input.catalog.subcategories
    .filter(item => item.isActive)
    .map(item => [item.id, item.name, item.categoryId]);

  return [
    'Interpreta la solicitud como un plan financiero para SmartFin.',
    'No inventes datos. Usa null cuando falte un dato y conserva varias operaciones en el orden solicitado.',
    'Las referencias clientRef permiten que una operacion use una entidad creada antes en el mismo plan.',
    'En cada accion, fieldsJson debe ser un string que contenga un objeto JSON valido.',
    'Campos permitidos dentro de fieldsJson: transactionType, amount, date, description, notes, accountId, accountName, accountRef, targetAccountId, targetAccountName, targetAccountRef, categoryId, categoryName, categoryRef, subcategoryId, subcategoryName, subcategoryRef, installmentCount, interestFreeInstallmentCount, transferTaxCharged, name, institutionName, initialBalance, recurringIncomeEnabled, recurringIncomeAmount, recurringIncomeDay, recurringIncomeFrequency, recurringIncomeType, bankName, creditLimit, lastFourDigits, closingDay, paymentDay, annualEffectiveInterestRate, managementFee, type y color.',
    'Omite de fieldsJson los valores desconocidos; no inventes identificadores.',
    'Solo asigna categoria o subcategoria cuando el usuario la mencione o el contexto sea inequívoco. Si falta contexto o hay varias posibilidades, omítela para que la aplicación pregunte.',
    `Fecha actual: ${input.now.toISOString()}. Zona horaria: ${input.timeZone}. Moneda unica: COP.`,
    `Cuentas activas [id,nombre,tipo,institucion]: ${JSON.stringify(accounts)}`,
    `Categorias [id,nombre,tipo]: ${JSON.stringify(categories)}`,
    `Subcategorias [id,nombre,categoriaId]: ${JSON.stringify(subcategories)}`,
    `Solicitud: ${input.text.trim()}`,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseModelPlan(text: string): AiCommandPlan {
  const decoded = JSON.parse(text) as unknown;
  if (!isRecord(decoded) || !Array.isArray(decoded.actions)) {
    return parseAiCommandPlan(decoded);
  }
  const actions = decoded.actions.map(action => {
    if (!isRecord(action)) return action;
    if (typeof action.fieldsJson !== 'string') return action;
    return {
      ...action,
      fields: JSON.parse(action.fieldsJson) as unknown,
    };
  });
  return parseAiCommandPlan({ ...decoded, actions });
}

function readResponseText(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Gemini devolvio una respuesta vacia.');
  const root = value as Record<string, unknown>;
  const candidates = root.candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') {
    throw new Error('Gemini no pudo interpretar la solicitud.');
  }
  const content = (candidates[0] as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') throw new Error('Gemini no devolvio contenido.');
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) throw new Error('Gemini no devolvio contenido estructurado.');
  const text = parts
    .map(part => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined)
    .find(part => typeof part === 'string');
  if (typeof text !== 'string') throw new Error('Gemini no devolvio JSON.');
  return text;
}

async function waitBriefly(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 500));
}

export function createGeminiCommandService(options: GeminiServiceOptions = {}) {
  const apiKey = options.apiKey ?? Config.GEMINI_API_KEY;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20000;

  return {
    interpret: async (input: GeminiInterpretationInput): Promise<AiCommandPlan> => {
      if (!apiKey?.trim()) {
        throw new Error('Falta GEMINI_API_KEY en el secreto de compilacion.');
      }
      if (!input.text.trim()) throw new Error('Escribe o dicta una solicitud.');
      if (input.text.length > MAX_INPUT_CHARACTERS) {
        throw new Error(`La solicitud supera ${MAX_INPUT_CHARACTERS} caracteres. Dividela en varios lotes.`);
      }

      const body = {
        contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(input) }] }],
        generationConfig: {
          candidateCount: 1,
          maxOutputTokens: 4096,
          responseFormat: {
            text: {
              mimeType: 'APPLICATION_JSON',
              schema: responseSchema,
            },
          },
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
        systemInstruction: {
          parts: [{ text: 'Eres un extractor de operaciones financieras. Devuelve solo el JSON solicitado; nunca SQL ni instrucciones ejecutables.' }],
        },
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetcher(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            {
              body: JSON.stringify(body),
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
              method: 'POST',
              signal: controller.signal,
            },
          );
          if (response.status === 429) {
            throw new Error('Se alcanzo el limite gratuito de Gemini. Intenta mas tarde.');
          }
          if (!response.ok) {
            if (response.status >= 500 && attempt === 0) {
              await waitBriefly();
              continue;
            }
            throw new Error(`Gemini no esta disponible (HTTP ${response.status}).`);
          }
          const payload = await response.json() as unknown;
          return parseModelPlan(readResponseText(payload));
        } catch (error) {
          if (error instanceof Error && error.message.includes('limite gratuito')) throw error;
          const isTimeout = error instanceof Error && error.name === 'AbortError';
          const isNetworkFailure = error instanceof TypeError;
          if (attempt === 0 && (isTimeout || isNetworkFailure)) {
            await waitBriefly();
            continue;
          }
          if (isTimeout) {
            throw new Error('Gemini tardo demasiado en responder.');
          }
          if (isNetworkFailure) {
            throw new Error('No se pudo conectar con Gemini. Revisa tu conexion.');
          }
          throw error instanceof Error ? error : new Error('No se pudo conectar con Gemini.');
        } finally {
          clearTimeout(timer);
        }
      }
      throw new Error('No se pudo conectar con Gemini.');
    },
  };
}

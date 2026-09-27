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
  type: 'OBJECT',
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'STRING' },
    actions: {
      type: 'ARRAY',
      maxItems: 20,
      items: {
        type: 'OBJECT',
        required: ['id', 'operation', 'entity', 'fields'],
        properties: {
          id: { type: 'STRING' },
          clientRef: { type: 'STRING', nullable: true },
          operation: { type: 'STRING', enum: ['create', 'update', 'delete'] },
          entity: { type: 'STRING', enum: ['transaction', 'debitAccount', 'creditCard', 'category', 'subcategory'] },
          targetId: { type: 'STRING', nullable: true },
          targetName: { type: 'STRING', nullable: true },
          fields: {
            type: 'OBJECT',
            properties: {
              transactionType: { type: 'STRING', enum: ['income', 'expense', 'internalTransfer'], nullable: true },
              amount: { type: 'NUMBER', nullable: true },
              date: { type: 'STRING', nullable: true },
              description: { type: 'STRING', nullable: true },
              notes: { type: 'STRING', nullable: true },
              accountId: { type: 'STRING', nullable: true },
              accountName: { type: 'STRING', nullable: true },
              accountRef: { type: 'STRING', nullable: true },
              targetAccountId: { type: 'STRING', nullable: true },
              targetAccountName: { type: 'STRING', nullable: true },
              targetAccountRef: { type: 'STRING', nullable: true },
              categoryId: { type: 'STRING', nullable: true },
              categoryName: { type: 'STRING', nullable: true },
              categoryRef: { type: 'STRING', nullable: true },
              subcategoryId: { type: 'STRING', nullable: true },
              subcategoryName: { type: 'STRING', nullable: true },
              subcategoryRef: { type: 'STRING', nullable: true },
              installmentCount: { type: 'NUMBER', nullable: true },
              interestFreeInstallmentCount: { type: 'NUMBER', nullable: true },
              transferTaxCharged: { type: 'BOOLEAN', nullable: true },
              name: { type: 'STRING', nullable: true },
              institutionName: { type: 'STRING', nullable: true },
              initialBalance: { type: 'NUMBER', nullable: true },
              recurringIncomeEnabled: { type: 'BOOLEAN', nullable: true },
              recurringIncomeAmount: { type: 'NUMBER', nullable: true },
              recurringIncomeDay: { type: 'NUMBER', nullable: true },
              recurringIncomeFrequency: { type: 'STRING', enum: ['biweekly', 'monthly', 'specificDay'], nullable: true },
              recurringIncomeType: { type: 'STRING', enum: ['salary', 'allowance', 'business', 'other'], nullable: true },
              bankName: { type: 'STRING', nullable: true },
              creditLimit: { type: 'NUMBER', nullable: true },
              lastFourDigits: { type: 'STRING', nullable: true },
              closingDay: { type: 'NUMBER', nullable: true },
              paymentDay: { type: 'NUMBER', nullable: true },
              annualEffectiveInterestRate: { type: 'NUMBER', nullable: true },
              managementFee: { type: 'NUMBER', nullable: true },
              type: { type: 'STRING', enum: ['expense', 'income'], nullable: true },
              color: { type: 'STRING', nullable: true },
            },
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
    `Fecha actual: ${input.now.toISOString()}. Zona horaria: ${input.timeZone}. Moneda unica: COP.`,
    `Cuentas activas [id,nombre,tipo,institucion]: ${JSON.stringify(accounts)}`,
    `Categorias [id,nombre,tipo]: ${JSON.stringify(categories)}`,
    `Subcategorias [id,nombre,categoriaId]: ${JSON.stringify(subcategories)}`,
    `Solicitud: ${input.text.trim()}`,
  ].join('\n');
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
          responseMimeType: 'application/json',
          responseSchema,
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
          return parseAiCommandPlan(JSON.parse(readResponseText(payload)) as unknown);
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

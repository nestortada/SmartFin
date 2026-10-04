jest.mock('react-native-config', () => ({ GEMINI_API_KEY: undefined }));

import type { Account } from '../src/modules/accounts';
import { buildGeminiPrompt, buildGeminiRevisionPrompt, createGeminiCommandService } from '../src/services';

const account: Account = {
  id: 'account-private',
  balance: { amount: 987654321, currency: 'COP' },
  createdAt: '2026-09-01T00:00:00.000Z',
  currency: 'COP',
  debtBalance: { amount: 444444, currency: 'COP' },
  institutionName: 'Banco Seguro',
  name: 'Cuenta principal',
  status: 'active',
  type: 'bankAccount',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('Gemini command service', () => {
  const input = {
    catalog: { accounts: [account], categories: [], subcategories: [] },
    now: new Date('2026-09-27T12:00:00.000Z'),
    text: 'Gaste 20 mil en cafe',
    timeZone: 'America/Bogota',
  };

  it('builds a minimal prompt without balances or history', () => {
    const prompt = buildGeminiPrompt({
      catalog: { accounts: [account], categories: [], subcategories: [] },
      now: new Date('2026-09-27T12:00:00.000Z'),
      text: 'Gaste 20 mil en cafe',
      timeZone: 'America/Bogota',
    });
    expect(prompt).toContain('Cuenta principal');
    expect(prompt).not.toContain('987654321');
    expect(prompt).not.toContain('444444');
    expect(prompt).toContain('NO es recurrente');
    expect(prompt).toContain('internalTransfer');
  });

  it('builds a revision prompt with only the active plan, answers and correction context', () => {
    const prompt = buildGeminiRevisionPrompt({
      ...input,
      clarificationHistory: [{
        actionId: 'a1', answerLabel: 'No, ocurre solo esta vez', answerValue: 'false',
        answeredAt: '2026-09-27T12:01:00.000Z', contextLabel: 'Cuenta Davivienda · ingreso de $900.000 COP',
        field: 'recurringIncomeEnabled', id: 'answer-1', prompt: '¿Este ingreso se repetirá?',
      }],
      correction: 'La segunda operación es una transferencia.',
      currentPlan: {
        actions: [{ entity: 'transaction', fields: { amount: 450000, transactionType: 'income' }, id: 'a1', operation: 'create' }],
        answeredFields: [], summary: 'Plan anterior', version: 1,
      },
      text: 'La segunda operación es una transferencia.',
    });
    expect(prompt).toContain('Plan actual');
    expect(prompt).toContain('Preguntas y respuestas del borrador');
    expect(prompt).toContain('La segunda operación es una transferencia.');
    expect(prompt).not.toContain('987654321');
  });

  it('uses one structured request and validates the returned plan', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo, _init?: RequestInit) => ({
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          actions: [{ entity: 'transaction', fieldsJson: '{"amount":20000}', id: 'a1', operation: 'create' }],
          summary: 'Registrar cafe',
        }) }] } }],
      }),
      ok: true,
      status: 200,
    }));
    const fetcher = fetchMock as unknown as typeof fetch;
    const result = await createGeminiCommandService({ apiKey: 'test-key', fetcher }).interpret(input);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.fields).toEqual({ amount: 20000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toEqual(expect.objectContaining({ 'x-goog-api-key': 'test-key' }));
    const requestBody = JSON.parse(String(request?.body)) as {
      generationConfig?: Record<string, unknown>;
    };
    expect(requestBody.generationConfig).toHaveProperty('responseFormat');
    expect(requestBody.generationConfig).not.toHaveProperty('responseSchema');
  });

  it('interprets a subscription response with its custom recurrence and reminder configuration', async () => {
    const subscriptionFields = { name: 'Netflix', amount: 44900, anchorDate: '2026-10-31', periodicity: 'custom', customInterval: 2, customUnit: 'months', remindersEnabled: true, reminderOffsets: [3, 1, 0], reminderHour: 9, reminderMinute: 0 };
    const fetcher = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Crear suscripción', actions: [{ id: 'subscription-1', entity: 'subscription', operation: 'create', fieldsJson: JSON.stringify(subscriptionFields) }] }) }] } }] }) })) as unknown as typeof fetch;
    const result = await createGeminiCommandService({ apiKey: 'test-key', fetcher }).interpret({ ...input, text: 'Crea una suscripción de Netflix' });
    expect(result.actions[0]).toMatchObject({ entity: 'subscription', fields: { ...subscriptionFields, reminderOffsets: '3,1,0' } });
    expect(buildGeminiPrompt(input)).toContain('no agregues una transaction');
    expect(buildGeminiPrompt({ ...input, now: new Date('2026-10-01T02:00:00Z') })).toContain('Fecha civil actual en esa zona: 2026-09-30');
  });

  it('fails locally when the build secret is missing', async () => {
    const fetchMock = jest.fn();
    await expect(createGeminiCommandService({
      apiKey: '',
      fetcher: fetchMock as unknown as typeof fetch,
    }).interpret(input)).rejects.toThrow('Falta GEMINI_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry a free-tier 429 response', async () => {
    const fetchMock = jest.fn(async () => ({
      json: async () => ({}),
      ok: false,
      status: 429,
    }));
    await expect(createGeminiCommandService({
      apiKey: 'test-key',
      fetcher: fetchMock as unknown as typeof fetch,
    }).interpret(input)).rejects.toThrow('limite gratuito');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries one 5xx response and succeeds on the next request', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ json: async () => ({}), ok: false, status: 503 })
      .mockResolvedValueOnce({
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            actions: [{ entity: 'transaction', fieldsJson: '{"amount":20000}', id: 'a1', operation: 'create' }],
            summary: 'Registrar cafe',
          }) }] } }],
        }),
        ok: true,
        status: 200,
      });
    await expect(createGeminiCommandService({
      apiKey: 'test-key',
      fetcher: fetchMock as unknown as typeof fetch,
    }).interpret(input)).resolves.toEqual(expect.objectContaining({ summary: 'Registrar cafe' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid JSON without spending a second request', async () => {
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{invalid' }] } }] }),
      ok: true,
      status: 200,
    }));
    await expect(createGeminiCommandService({
      apiKey: 'test-key',
      fetcher: fetchMock as unknown as typeof fetch,
    }).interpret(input)).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a timeout only once and returns a local error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchMock = jest.fn(async () => { throw abortError; });
    await expect(createGeminiCommandService({
      apiKey: 'test-key',
      fetcher: fetchMock as unknown as typeof fetch,
      timeoutMs: 1,
    }).interpret(input)).rejects.toThrow('tardo demasiado');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

export type ServiceBoundary = 'local-device' | 'external-provider';
export {
  buildGeminiPrompt,
  createGeminiCommandService,
  type GeminiCatalog,
  type GeminiInterpretationInput,
} from './geminiCommandService';

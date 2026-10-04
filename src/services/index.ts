export type ServiceBoundary = 'local-device' | 'external-provider';
export {
  buildGeminiPrompt,
  buildGeminiRevisionPrompt,
  createGeminiCommandService,
  type GeminiCatalog,
  type GeminiInterpretationInput,
  type GeminiRevisionInput,
} from './geminiCommandService';

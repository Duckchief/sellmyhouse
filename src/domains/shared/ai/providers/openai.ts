import type { AIProvider, AIGenerateOptions, AIGenerateResult } from '../ai.types';

export class OpenAIProvider implements AIProvider {
  name = 'openai';

  async generateText(_prompt: string, _options: AIGenerateOptions): Promise<AIGenerateResult> {
    // OpenAI provider — implemented when needed
    throw new Error('OpenAI provider not yet implemented');
  }
}

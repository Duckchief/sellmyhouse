import type { AIProvider, AIGenerateOptions, AIGenerateResult } from '../ai.types';

export class GoogleProvider implements AIProvider {
  name = 'google';

  async generateText(_prompt: string, _options: AIGenerateOptions): Promise<AIGenerateResult> {
    // Google provider — implemented when needed
    throw new Error('Google provider not yet implemented');
  }
}

import type { AIProvider, AIGenerateOptions, AIGenerateResult } from './ai.types';
import * as settingsService from '../settings.service';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';

const providers: Record<string, AIProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  google: new GoogleProvider(),
};

export async function getProvider(): Promise<AIProvider> {
  const providerName = await settingsService.get('ai_provider', 'anthropic');
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerName}`);
  }
  return provider;
}

export async function generateText(
  prompt: string,
  options: AIGenerateOptions = {},
): Promise<AIGenerateResult> {
  const provider = await getProvider();

  // Read defaults from settings if not provided
  if (!options.model) {
    options.model = await settingsService.get('ai_model', 'claude-sonnet-4-20250514');
  }
  if (!options.maxTokens) {
    options.maxTokens = await settingsService.getNumber('ai_max_tokens', 2000);
  }
  if (options.temperature === undefined) {
    options.temperature = await settingsService.getNumber('ai_temperature', 0.3);
  }

  return provider.generateText(prompt, options);
}

import type { AIProvider, AIGenerateOptions, AIGenerateResult } from './ai.types';
import * as settingsService from '../settings.service';
import * as auditService from '../audit.service';
import { ValidationError } from '../errors';
import { logger } from '@/infra/logger';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';

const providers: Record<string, AIProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  google: new GoogleProvider(),
};

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

export function getProvider(providerName?: string): AIProvider {
  const name = providerName ?? 'anthropic';
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${name}`);
  }
  return provider;
}

async function resolveOptions(options: AIGenerateOptions = {}): Promise<AIGenerateOptions> {
  const resolved = { ...options };
  if (!resolved.model) {
    resolved.model = await settingsService.get('ai_model', 'claude-sonnet-4-20250514');
  }
  if (!resolved.maxTokens) {
    resolved.maxTokens = await settingsService.getNumber('ai_max_tokens', 2000);
  }
  if (resolved.temperature === undefined) {
    resolved.temperature = await settingsService.getNumber('ai_temperature', 0.3);
  }
  return resolved;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryProviderWithRetry(
  providerName: string,
  prompt: string,
  options: AIGenerateOptions,
  maxRetries: number,
  delayMs: number,
): Promise<AIGenerateResult | null> {
  const provider = getProvider(providerName);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await provider.generateText(prompt, options);
    } catch (err) {
      logger.warn(
        { provider: providerName, attempt: attempt + 1, maxAttempts: maxRetries + 1, err },
        'AI provider attempt failed',
      );
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }
  return null;
}

/**
 * Generate text with retry and optional fallback provider.
 *
 * Flow:
 * 1. Try primary provider (from ai_provider SystemSetting)
 * 2. On failure, retry N times with delay
 * 3. If still failing and ai_fallback_provider is set, try fallback
 * 4. If all fail, throw AIUnavailableError (caller handles graceful degradation)
 */
export async function generateText(
  prompt: string,
  options: AIGenerateOptions = {},
): Promise<AIGenerateResult> {
  if (prompt.length > 50000) {
    throw new ValidationError('Prompt exceeds maximum length');
  }

  const primaryProviderName = await settingsService.get('ai_provider', 'anthropic');
  const retryCount = await settingsService.getNumber('ai_retry_count', 1);
  const retryDelay = await settingsService.getNumber('ai_retry_delay_ms', 2000);
  const fallbackProviderName = await settingsService.get('ai_fallback_provider', '');

  const resolved = await resolveOptions(options);

  // Try primary provider with retries
  const primaryResult = await tryProviderWithRetry(
    primaryProviderName,
    prompt,
    resolved,
    retryCount,
    retryDelay,
  );
  if (primaryResult) return primaryResult;

  // Try fallback provider if configured
  if (fallbackProviderName && fallbackProviderName !== primaryProviderName) {
    logger.warn(
      { primaryProvider: primaryProviderName, fallbackProvider: fallbackProviderName },
      'AI primary provider failed, trying fallback',
    );

    await auditService.log({
      action: 'ai.fallback_triggered',
      entityType: 'system',
      entityId: 'ai_facade',
      details: { primaryProvider: primaryProviderName, fallbackProvider: fallbackProviderName },
    });

    const fallbackResult = await tryProviderWithRetry(
      fallbackProviderName,
      prompt,
      resolved,
      1,
      retryDelay,
    );
    if (fallbackResult) return fallbackResult;
  }

  // All providers failed
  await auditService.log({
    action: 'ai.all_providers_failed',
    entityType: 'system',
    entityId: 'ai_facade',
    details: {
      primaryProvider: primaryProviderName,
      fallbackProvider: fallbackProviderName || 'none',
    },
  });

  throw new AIUnavailableError(
    `AI generation failed. Primary: ${primaryProviderName}${fallbackProviderName ? `, Fallback: ${fallbackProviderName}` : ''}. Agent may need to write content manually.`,
  );
}

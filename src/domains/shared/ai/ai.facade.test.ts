const mockAnthropicGenerateText = jest.fn();
const mockOpenaiGenerateText = jest.fn();

jest.mock('./providers/anthropic', () => ({
  AnthropicProvider: jest.fn().mockImplementation(() => ({
    name: 'anthropic',
    generateText: mockAnthropicGenerateText,
  })),
}));

jest.mock('./providers/openai', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    name: 'openai',
    generateText: mockOpenaiGenerateText,
  })),
}));

jest.mock('./providers/google', () => ({
  GoogleProvider: jest.fn().mockImplementation(() => ({
    name: 'google',
    generateText: jest.fn(),
  })),
}));

jest.mock('../settings.service');
jest.mock('../audit.service');
jest.mock('@/infra/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getProvider, generateText, AIUnavailableError } from './ai.facade';
import * as settingsService from '../settings.service';
import * as auditService from '../audit.service';

const mockSettings = settingsService as jest.Mocked<typeof settingsService>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;

describe('ai.facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default settings for all tests
    mockSettings.get.mockImplementation((key: string, def?: string) => {
      const values: Record<string, string> = {
        ai_provider: 'anthropic',
        ai_model: 'claude-sonnet-4-20250514',
        ai_fallback_provider: '',
      };
      return Promise.resolve(values[key] ?? def ?? '');
    });
    mockSettings.getNumber.mockImplementation((key: string, def?: number) => {
      const values: Record<string, number> = {
        ai_max_tokens: 2000,
        ai_temperature: 0.3,
        ai_retry_count: 1,
        ai_retry_delay_ms: 10, // fast for tests
      };
      return Promise.resolve(values[key] ?? def ?? 0);
    });
    mockAudit.log.mockResolvedValue(undefined);
  });

  describe('getProvider', () => {
    it('returns anthropic provider by name', () => {
      const provider = getProvider('anthropic');
      expect(provider.name).toBe('anthropic');
    });

    it('returns openai provider by name', () => {
      const provider = getProvider('openai');
      expect(provider.name).toBe('openai');
    });

    it('throws for unknown provider', () => {
      expect(() => getProvider('unknown')).toThrow('Unknown AI provider: unknown');
    });
  });

  describe('generateText', () => {
    it('returns result on first successful attempt', async () => {
      mockAnthropicGenerateText.mockResolvedValue({
        text: 'Generated text',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        tokensUsed: 10,
      });

      const result = await generateText('test prompt');
      expect(result.text).toBe('Generated text');
      expect(mockAnthropicGenerateText).toHaveBeenCalledTimes(1);
    });

    it('reads default options from settings when not provided', async () => {
      mockAnthropicGenerateText.mockResolvedValue({
        text: 'test',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });

      await generateText('test prompt');

      expect(mockSettings.get).toHaveBeenCalledWith('ai_provider', 'anthropic');
      expect(mockSettings.get).toHaveBeenCalledWith('ai_model', 'claude-sonnet-4-20250514');
    });

    it('retries on first failure and succeeds on second attempt', async () => {
      mockAnthropicGenerateText
        .mockRejectedValueOnce(new Error('API timeout'))
        .mockResolvedValueOnce({
          text: 'Retry success',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        });

      const result = await generateText('test prompt');
      expect(result.text).toBe('Retry success');
      expect(mockAnthropicGenerateText).toHaveBeenCalledTimes(2);
    });

    it('falls back to secondary provider when primary exhausts retries', async () => {
      mockAnthropicGenerateText.mockRejectedValue(new Error('Primary down'));
      mockOpenaiGenerateText.mockResolvedValue({
        text: 'Fallback text',
        provider: 'openai',
        model: 'gpt-4o',
      });

      mockSettings.get.mockImplementation((key: string, def?: string) => {
        const values: Record<string, string> = {
          ai_provider: 'anthropic',
          ai_model: 'claude-sonnet-4-20250514',
          ai_fallback_provider: 'openai',
        };
        return Promise.resolve(values[key] ?? def ?? '');
      });

      const result = await generateText('test prompt');
      expect(result.provider).toBe('openai');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.fallback_triggered' }),
      );
    });

    it('throws AIUnavailableError when all providers fail', async () => {
      mockAnthropicGenerateText.mockRejectedValue(new Error('Down'));
      mockOpenaiGenerateText.mockRejectedValue(new Error('Also down'));

      mockSettings.get.mockImplementation((key: string, def?: string) => {
        const values: Record<string, string> = {
          ai_provider: 'anthropic',
          ai_model: 'claude-sonnet-4-20250514',
          ai_fallback_provider: 'openai',
        };
        return Promise.resolve(values[key] ?? def ?? '');
      });

      await expect(generateText('test prompt')).rejects.toThrow(AIUnavailableError);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.all_providers_failed' }),
      );
    });

    it('throws AIUnavailableError when no fallback configured and primary fails', async () => {
      mockAnthropicGenerateText.mockRejectedValue(new Error('Down'));

      await expect(generateText('test prompt')).rejects.toThrow(AIUnavailableError);
    });

    it('does not try fallback when fallback is same as primary', async () => {
      mockAnthropicGenerateText.mockRejectedValue(new Error('Down'));

      mockSettings.get.mockImplementation((key: string, def?: string) => {
        const values: Record<string, string> = {
          ai_provider: 'anthropic',
          ai_model: 'claude-sonnet-4-20250514',
          ai_fallback_provider: 'anthropic',
        };
        return Promise.resolve(values[key] ?? def ?? '');
      });

      await expect(generateText('test prompt')).rejects.toThrow(AIUnavailableError);
      // Should not have triggered fallback audit log
      expect(mockAudit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.fallback_triggered' }),
      );
    });
  });
});

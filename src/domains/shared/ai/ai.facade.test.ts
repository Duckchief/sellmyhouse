jest.mock('./providers/anthropic', () => ({
  AnthropicProvider: jest.fn().mockImplementation(() => ({
    name: 'anthropic',
    generateText: jest.fn().mockResolvedValue({
      text: 'test', provider: 'anthropic', model: 'test', tokensUsed: 10,
    }),
  })),
}));

jest.mock('./providers/openai', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    name: 'openai',
    generateText: jest.fn(),
  })),
}));

jest.mock('./providers/google', () => ({
  GoogleProvider: jest.fn().mockImplementation(() => ({
    name: 'google',
    generateText: jest.fn(),
  })),
}));

jest.mock('../settings.service');

import { getProvider, generateText } from './ai.facade';
import * as settingsService from '../settings.service';

const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

describe('ai.facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProvider', () => {
    it('returns anthropic provider when setting is anthropic', async () => {
      mockSettings.get.mockResolvedValue('anthropic');
      const provider = await getProvider();
      expect(provider.name).toBe('anthropic');
    });

    it('returns openai provider when setting is openai', async () => {
      mockSettings.get.mockResolvedValue('openai');
      const provider = await getProvider();
      expect(provider.name).toBe('openai');
    });

    it('throws for unknown provider', async () => {
      mockSettings.get.mockResolvedValue('unknown');
      await expect(getProvider()).rejects.toThrow('Unknown AI provider: unknown');
    });
  });

  describe('generateText', () => {
    it('reads default options from settings when not provided', async () => {
      mockSettings.get
        .mockResolvedValueOnce('anthropic') // provider
        .mockResolvedValueOnce('claude-sonnet-4-20250514'); // model
      mockSettings.getNumber
        .mockResolvedValueOnce(2000) // maxTokens
        .mockResolvedValueOnce(0.3); // temperature

      await generateText('test prompt');

      expect(mockSettings.get).toHaveBeenCalledWith('ai_provider', 'anthropic');
      expect(mockSettings.get).toHaveBeenCalledWith('ai_model', 'claude-sonnet-4-20250514');
    });
  });
});

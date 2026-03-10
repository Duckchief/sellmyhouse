import type { AIProvider, AIGenerateOptions, AIGenerateResult } from '../ai.types';

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';

  async generateText(prompt: string, options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error('Anthropic SDK not installed');
    });

    const client = new Anthropic({
      apiKey: process.env.AI_ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: options.model || 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature ?? 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      text,
      provider: this.name,
      model: response.model,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }
}

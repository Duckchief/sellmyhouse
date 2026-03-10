export interface AIGenerateOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIGenerateResult {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

export interface AIProvider {
  name: string;
  generateText(prompt: string, options: AIGenerateOptions): Promise<AIGenerateResult>;
}

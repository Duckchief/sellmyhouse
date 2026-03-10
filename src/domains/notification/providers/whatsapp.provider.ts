import axios from 'axios';
import type { ChannelProvider } from '../notification.types';
import * as agentSettingsService from '../../agent-settings/agent-settings.service';
import { logger } from '../../../infra/logger';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class WhatsAppProvider implements ChannelProvider {
  async send(
    recipientPhone: string,
    content: string,
    agentId: string,
  ): Promise<{ messageId?: string }> {
    const token = await agentSettingsService.getSetting(agentId, 'whatsapp_api_token');
    const phoneNumberId = await agentSettingsService.getSetting(agentId, 'whatsapp_phone_number_id');

    if (!token || !phoneNumberId) {
      throw new Error('WhatsApp not configured for this agent');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'text',
            text: { body: content },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        const messageId = response.data?.messages?.[0]?.id;
        return { messageId };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { attempt: attempt + 1, err: lastError.message },
          'WhatsApp send attempt failed',
        );

        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('WhatsApp send failed after retries');
  }
}

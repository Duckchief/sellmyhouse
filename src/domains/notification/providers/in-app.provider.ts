import type { ChannelProvider } from '../notification.types';

export class InAppProvider implements ChannelProvider {
  async send(
    _recipientId: string,
    _content: string,
    _agentId: string,
  ): Promise<{ messageId?: string }> {
    // In-app notifications are already persisted as DB records.
    // No external send needed — this is a no-op provider.
    return {};
  }
}

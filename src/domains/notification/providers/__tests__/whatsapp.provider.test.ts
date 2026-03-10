import { WhatsAppProvider } from '../whatsapp.provider';

jest.mock('../../../agent-settings/agent-settings.service');
jest.mock('axios');

const agentSettingsService = jest.requireMock('../../../agent-settings/agent-settings.service');
const axios = jest.requireMock('axios');

describe('WhatsAppProvider', () => {
  let provider: WhatsAppProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new WhatsAppProvider();
  });

  function mockSettings() {
    agentSettingsService.getSetting = jest
      .fn()
      .mockImplementation((_agentId: string, key: string) => {
        const map: Record<string, string> = {
          whatsapp_api_token: 'test-token',
          whatsapp_phone_number_id: '12345',
        };
        return Promise.resolve(map[key] ?? null);
      });
  }

  it('throws when WhatsApp not configured', async () => {
    agentSettingsService.getSetting = jest.fn().mockResolvedValue(null);

    await expect(provider.send('6591234567', 'Hello', 'agent1')).rejects.toThrow(
      'WhatsApp not configured',
    );
  });

  it('calls correct Meta API endpoint', async () => {
    mockSettings();
    axios.post = jest.fn().mockResolvedValue({
      data: { messages: [{ id: 'wamid.123' }] },
    });

    const result = await provider.send('6591234567', 'Test message', 'agent1');

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v18.0/12345/messages',
      expect.objectContaining({
        messaging_product: 'whatsapp',
        to: '6591234567',
        type: 'text',
        text: { body: 'Test message' },
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result.messageId).toBe('wamid.123');
  });

  it('retries on failure up to 3 times', async () => {
    mockSettings();
    axios.post = jest.fn().mockRejectedValue(new Error('Network error'));

    await expect(provider.send('6591234567', 'Hello', 'agent1')).rejects.toThrow('Network error');

    expect(axios.post).toHaveBeenCalledTimes(3);
  }, 15000);

  it('succeeds on retry', async () => {
    mockSettings();
    axios.post = jest
      .fn()
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.456' }] },
      });

    const result = await provider.send('6591234567', 'Hello', 'agent1');
    expect(result.messageId).toBe('wamid.456');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});

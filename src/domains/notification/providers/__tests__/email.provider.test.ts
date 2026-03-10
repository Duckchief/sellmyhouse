import { EmailProvider } from '../email.provider';

jest.mock('../../../agent-settings/agent-settings.service');
jest.mock('nodemailer');

const agentSettingsService = jest.requireMock('../../../agent-settings/agent-settings.service');
const nodemailer = jest.requireMock('nodemailer');

describe('EmailProvider', () => {
  let provider: EmailProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new EmailProvider();
  });

  it('throws when SMTP not configured', async () => {
    agentSettingsService.getSetting = jest.fn().mockResolvedValue(null);

    await expect(
      provider.send('user@test.com', '<p>Hello</p>', 'agent1'),
    ).rejects.toThrow('SMTP not configured');
  });

  it('creates transporter with correct credentials', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg123>' });
    nodemailer.createTransport = jest.fn().mockReturnValue({ sendMail });

    agentSettingsService.getSetting = jest.fn().mockImplementation(
      (_agentId: string, key: string) => {
        const map: Record<string, string> = {
          smtp_host: 'smtp.test.com',
          smtp_port: '587',
          smtp_user: 'user@test.com',
          smtp_pass: 'secret',
          smtp_from_email: 'noreply@test.com',
          smtp_from_name: 'Test Agent',
        };
        return Promise.resolve(map[key] ?? null);
      },
    );

    const result = await provider.send('recipient@test.com', '<p>Hi</p>', 'agent1');

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'user@test.com', pass: 'secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'recipient@test.com',
        html: '<p>Hi</p>',
      }),
    );
    expect(result.messageId).toBe('<msg123>');
  });
});

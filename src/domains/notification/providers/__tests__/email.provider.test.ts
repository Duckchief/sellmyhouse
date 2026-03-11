import { EmailProvider } from '../email.provider';

jest.mock('../../../agent-settings/agent-settings.service');
jest.mock('nodemailer');

const agentSettingsService = jest.requireMock('../../../agent-settings/agent-settings.service');
const nodemailer = jest.requireMock('nodemailer');

// Helper to set up valid SMTP mock settings
function mockSmtpSettings(sendMail: jest.Mock) {
  nodemailer.createTransport = jest.fn().mockReturnValue({ sendMail });
  agentSettingsService.getSetting = jest
    .fn()
    .mockImplementation((_agentId: string, key: string) => {
      const map: Record<string, string> = {
        smtp_host: 'smtp.test.com',
        smtp_port: '587',
        smtp_user: 'user@test.com',
        smtp_pass: 'secret',
        smtp_from_email: 'noreply@test.com',
        smtp_from_name: 'Test Agent',
      };
      return Promise.resolve(map[key] ?? null);
    });
}

describe('EmailProvider', () => {
  let provider: EmailProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    provider = new EmailProvider();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws when SMTP not configured', async () => {
    agentSettingsService.getSetting = jest.fn().mockResolvedValue(null);

    await expect(provider.send('user@test.com', '<p>Hello</p>', 'agent1')).rejects.toThrow(
      'SMTP not configured',
    );
  });

  it('creates transporter with correct credentials', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg123>' });
    mockSmtpSettings(sendMail);

    const resultPromise = provider.send('recipient@test.com', '<p>Hi</p>', 'agent1');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

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

  it('passes attachments to sendMail', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg-attach>' });
    mockSmtpSettings(sendMail);

    const attachment = {
      filename: 'report.pdf',
      content: Buffer.from('pdf'),
      contentType: 'application/pdf',
    };

    const resultPromise = provider.send('test@test.com', '<p>Hi</p>', 'agent1', {
      attachments: [attachment],
    });
    await jest.runAllTimersAsync();
    await resultPromise;

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ filename: 'report.pdf' })],
      }),
    );
  });

  it('retries on failure up to 3 times', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP connection failed'));
    mockSmtpSettings(sendMail);

    // Start the send, then run all pending timers to skip backoff delays
    const resultPromise = provider
      .send('test@test.com', '<p>Hi</p>', 'agent1')
      .catch((err) => err);

    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('succeeds on retry', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce(new Error('Temp'))
      .mockResolvedValueOnce({ messageId: '<msg>' });
    mockSmtpSettings(sendMail);

    const resultPromise = provider.send('test@test.com', '<p>Hi</p>', 'agent1');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.messageId).toBe('<msg>');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('uses custom subject when provided in options', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg-subj>' });
    mockSmtpSettings(sendMail);

    const resultPromise = provider.send('test@test.com', '<p>Hi</p>', 'agent1', {
      subject: 'Custom Subject',
    });
    await jest.runAllTimersAsync();
    await resultPromise;

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Custom Subject' }),
    );
  });
});

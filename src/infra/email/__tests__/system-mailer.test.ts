jest.mock('nodemailer');

import nodemailer from 'nodemailer';

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

describe('sendSystemEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });

    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'noreply@sellmyhomenow.sg';
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it('sends email with correct parameters', async () => {
    const { sendSystemEmail } = await import('../system-mailer');
    await sendSystemEmail('seller@example.com', 'Test Subject', '<p>Hello</p>');

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@sellmyhomenow.sg',
        to: 'seller@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }),
    );
  });

  it('throws if SMTP_HOST is missing', async () => {
    delete process.env.SMTP_HOST;
    const { sendSystemEmail } = await import('../system-mailer');
    await expect(
      sendSystemEmail('seller@example.com', 'Subject', 'body'),
    ).rejects.toThrow('System SMTP not configured');
  });

  it('sets secure to true for port 465', async () => {
    process.env.SMTP_PORT = '465';
    const { sendSystemEmail } = await import('../system-mailer');
    await sendSystemEmail('seller@example.com', 'Subject', 'body');
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, port: 465 }),
    );
  });
});

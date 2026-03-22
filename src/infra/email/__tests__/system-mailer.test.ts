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

  it('logs via stub when SMTP_HOST is missing', async () => {
    delete process.env.SMTP_HOST;
    jest.resetModules();
    const loggerModule = await import('../../../infra/logger');
    const logSpy = jest.spyOn(loggerModule.logger, 'info');
    const { sendSystemEmail } = await import('../system-mailer');

    await sendSystemEmail('seller@example.com', 'Subject', 'body');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'seller@example.com' }),
      expect.stringContaining('[EMAIL_STUB]'),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('logs email via logger when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    jest.resetModules();
    const loggerModule = await import('../../../infra/logger');
    const logSpy = jest.spyOn(loggerModule.logger, 'info');
    const { sendSystemEmail } = await import('../system-mailer');

    await sendSystemEmail('seller@example.com', 'Verify Email', '<p>Click here</p>');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'seller@example.com', subject: 'Verify Email' }),
      expect.stringContaining('[EMAIL_STUB]'),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('sets secure to true for port 465', async () => {
    process.env.SMTP_PORT = '465';
    jest.resetModules();
    jest.mock('nodemailer');
    const nm = await import('nodemailer');
    const localMockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
    const localMockCreateTransport = nm.default.createTransport as jest.Mock;
    localMockCreateTransport.mockReturnValue({ sendMail: localMockSendMail });

    const { sendSystemEmail } = await import('../system-mailer');
    await sendSystemEmail('seller@example.com', 'Subject', 'body');
    expect(localMockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, port: 465 }),
    );
  });
});

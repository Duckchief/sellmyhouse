import nodemailer from 'nodemailer';
import { logger } from '../logger';

function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!isSmtpConfigured()) {
    logger.info({ to, subject, html }, '[EMAIL_STUB] Email not sent — SMTP not configured');
    return;
  }

  const port = parseInt(process.env.SMTP_PORT!, 10);
  if (isNaN(port)) {
    logger.info({ to, subject, html }, '[EMAIL_STUB] Email not sent — SMTP_PORT invalid');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  await transporter.sendMail({ from: process.env.SMTP_FROM!, to, subject, html });
}

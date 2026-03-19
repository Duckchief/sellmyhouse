import nodemailer from 'nodemailer';

export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) {
    throw new Error('System SMTP not configured');
  }

  const portNum = parseInt(port, 10);
  if (isNaN(portNum)) {
    throw new Error('System SMTP not configured');
  }
  const transporter = nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({ from, to, subject, html });
}

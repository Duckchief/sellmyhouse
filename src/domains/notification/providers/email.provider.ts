import nodemailer from 'nodemailer';
import nunjucks from 'nunjucks';
import path from 'path';
import type { ChannelProvider, EmailAttachment } from '../notification.types';
import * as agentSettingsService from '../../agent-settings/agent-settings.service';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const viewsPath = path.join(__dirname, '..', '..', '..', 'views');
const njkEnv = nunjucks.configure(viewsPath, { autoescape: true });
njkEnv.addFilter('t', (str: string) => str);

export class EmailProvider implements ChannelProvider {
  async send(
    recipientEmail: string,
    content: string,
    agentId: string,
    options?: { subject?: string; attachments?: EmailAttachment[]; unsubscribeUrl?: string },
  ): Promise<{ messageId?: string }> {
    const host = await agentSettingsService.getSetting(agentId, 'smtp_host');
    const port = await agentSettingsService.getSetting(agentId, 'smtp_port');
    const user = await agentSettingsService.getSetting(agentId, 'smtp_user');
    const pass = await agentSettingsService.getSetting(agentId, 'smtp_pass');
    const fromEmail = await agentSettingsService.getSetting(agentId, 'smtp_from_email');
    const fromName = await agentSettingsService.getSetting(agentId, 'smtp_from_name');

    if (!host || !port || !user || !pass) {
      throw new Error('SMTP not configured for this agent');
    }

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: parseInt(port, 10) === 465,
      auth: { user, pass },
    });

    const renderedHtml = njkEnv.render('emails/notification.njk', {
      content,
      unsubscribeUrl: options?.unsubscribeUrl,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await transporter.sendMail({
          from: fromName ? `"${fromName}" <${fromEmail || user}>` : fromEmail || user,
          to: recipientEmail,
          subject: options?.subject || 'SellMyHomeNow Notification',
          html: renderedHtml,
          ...(options?.attachments && {
            attachments: options.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }),
        });
        return { messageId: result.messageId };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Email send failed after retries');
  }
}

import nodemailer from 'nodemailer';
import type { ChannelProvider } from '../notification.types';
import * as agentSettingsService from '../../agent-settings/agent-settings.service';

export class EmailProvider implements ChannelProvider {
  async send(
    recipientEmail: string,
    content: string,
    agentId: string,
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

    const result = await transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromEmail || user}>` : fromEmail || user,
      to: recipientEmail,
      subject: 'SellMyHomeNow Notification',
      html: content,
    });

    return { messageId: result.messageId };
  }
}

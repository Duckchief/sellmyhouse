export type NotificationChannel = 'whatsapp' | 'email' | 'in_app';
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
export type RecipientType = 'seller' | 'agent' | 'viewer';
export type NotificationType = 'transactional' | 'marketing';

export type NotificationTemplateName =
  | 'welcome_seller'
  | 'viewing_booked'
  | 'viewing_booked_seller'
  | 'viewing_cancelled'
  | 'viewing_reminder'
  | 'viewing_reminder_viewer'
  | 'viewing_feedback_prompt'
  | 'offer_received'
  | 'offer_countered'
  | 'offer_accepted'
  | 'transaction_update'
  | 'document_ready'
  | 'invoice_uploaded'
  | 'agreement_sent'
  | 'financial_report_ready'
  | 'generic';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface DncCheckResult {
  blocked: boolean;
  reason?: string;
}

export interface SendNotificationInput {
  recipientType: RecipientType;
  recipientId: string;
  templateName: NotificationTemplateName;
  templateData: Record<string, string>;
  preferredChannel?: NotificationChannel;
  notificationType?: NotificationType; // defaults to 'transactional'
  attachments?: EmailAttachment[];
  recipientPhone?: string;
  recipientEmail?: string;
}

export interface NotificationRecord {
  id: string;
  recipientType: RecipientType;
  recipientId: string;
  channel: NotificationChannel;
  templateName: string;
  content: string;
  status: NotificationStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  whatsappMessageId: string | null;
  error: string | null;
  createdAt: Date;
}

export interface ChannelProvider {
  send(
    recipientId: string,
    content: string,
    agentId: string,
    options?: { subject?: string; attachments?: EmailAttachment[]; unsubscribeUrl?: string },
  ): Promise<{ messageId?: string }>;
}

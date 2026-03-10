export type NotificationChannel = 'whatsapp' | 'email' | 'in_app';
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
export type RecipientType = 'seller' | 'agent';

export type NotificationTemplateName =
  | 'welcome_seller'
  | 'viewing_booked'
  | 'viewing_cancelled'
  | 'viewing_reminder'
  | 'offer_received'
  | 'offer_countered'
  | 'offer_accepted'
  | 'transaction_update'
  | 'document_ready'
  | 'invoice_uploaded'
  | 'agreement_sent'
  | 'generic';

export interface SendNotificationInput {
  recipientType: RecipientType;
  recipientId: string;
  templateName: NotificationTemplateName;
  templateData: Record<string, string>;
  preferredChannel?: NotificationChannel;
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
  ): Promise<{ messageId?: string }>;
}

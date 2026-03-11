import type { NotificationTemplateName } from './notification.types';

export type WhatsAppTemplateStatus = 'approved' | 'pending' | 'suspended';

export interface NotificationTemplate {
  subject: string;
  body: string;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationTemplateName, NotificationTemplate> = {
  welcome_seller: {
    subject: 'Welcome to SellMyHomeNow',
    body: 'Welcome to SellMyHomeNow, {{name}}! Your account is ready.',
  },
  viewing_booked: {
    subject: 'Viewing Booked — {{address}}',
    body: 'A viewing has been booked for {{address}} on {{date}}.',
  },
  viewing_booked_seller: {
    subject: 'New Viewing Booked — {{address}}',
    body: 'New viewing booked for {{address}} on {{date}} at {{time}}. Viewer: {{viewerName}} ({{viewerType}}).{{noShowWarning}}',
  },
  viewing_cancelled: {
    subject: 'Viewing Cancelled — {{address}}',
    body: 'The viewing for {{address}} on {{date}} has been cancelled.',
  },
  viewing_reminder: {
    subject: 'Reminder: Upcoming Viewing — {{address}}',
    body: 'Reminder: Viewing for {{address}} is scheduled for {{date}}.',
  },
  viewing_reminder_viewer: {
    subject: 'Reminder: Your Viewing Today',
    body: 'Reminder: Your viewing at {{address}} is at {{time}} today.',
  },
  viewing_feedback_prompt: {
    subject: 'Feedback Request — {{address}}',
    body: 'How did the viewing go for {{address}} on {{date}}? Please log your feedback.',
  },
  offer_received: {
    subject: 'Offer Received — {{address}}',
    body: 'An offer of ${{amount}} has been received for {{address}}.',
  },
  offer_countered: {
    subject: 'Counter-Offer Made — {{address}}',
    body: 'A counter-offer of ${{amount}} has been made for {{address}}.',
  },
  offer_accepted: {
    subject: 'Offer Accepted — {{address}}',
    body: 'The offer for {{address}} has been accepted. Congratulations!',
  },
  offer_analysis_shared: {
    subject: 'Market Analysis for Your Offer — {{address}}',
    body: 'Your agent has shared a market analysis for the offer on {{address}}:\n\n{{analysis}}\n\nThis is indicative only based on public HDB data. It does not constitute financial or legal advice.',
  },
  transaction_update: {
    subject: 'Transaction Update — {{address}}',
    body: 'Transaction update for {{address}}: {{status}}.',
  },
  document_ready: {
    subject: 'Document Ready for Review',
    body: 'A document is ready for your review: {{documentName}}.',
  },
  invoice_uploaded: {
    subject: 'Commission Invoice Uploaded — {{address}}',
    body: 'Your commission invoice has been uploaded for {{address}}.',
  },
  agreement_sent: {
    subject: 'Estate Agency Agreement — {{address}}',
    body: 'The estate agency agreement for {{address}} has been sent to you.',
  },
  financial_report_ready: {
    subject: 'Financial Report Ready — {{address}}',
    body: 'Your financial report for {{address}} is ready. {{message}}',
  },
  generic: {
    subject: 'Notification from SellMyHomeNow',
    body: '{{message}}',
  },
};

// WhatsApp template approval status — update as templates are approved by Meta
export const WHATSAPP_TEMPLATE_STATUS: Record<NotificationTemplateName, WhatsAppTemplateStatus> = {
  welcome_seller: 'pending',
  viewing_booked: 'pending',
  viewing_booked_seller: 'pending',
  viewing_cancelled: 'pending',
  viewing_reminder: 'pending',
  viewing_reminder_viewer: 'pending',
  viewing_feedback_prompt: 'pending',
  offer_received: 'pending',
  offer_countered: 'pending',
  offer_accepted: 'pending',
  offer_analysis_shared: 'pending',
  transaction_update: 'pending',
  document_ready: 'pending',
  invoice_uploaded: 'pending',
  agreement_sent: 'pending',
  financial_report_ready: 'pending',
  generic: 'pending',
};

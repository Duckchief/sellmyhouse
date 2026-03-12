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
  otp_exercise_reminder_14d: {
    subject: 'OTP Exercise Reminder — 14 Days Remaining',
    body: 'Reminder: OTP exercise deadline is in 14 days. Please follow up with your buyer.',
  },
  otp_exercise_reminder_7d: {
    subject: 'OTP Exercise Reminder — 7 Days Remaining',
    body: 'Reminder: OTP exercise deadline is in 7 days. Please follow up with your buyer.',
  },
  otp_exercise_reminder_3d: {
    subject: 'Urgent: OTP Exercise Deadline in 3 Days',
    body: 'Urgent: OTP exercise deadline is in 3 days. Please contact your buyer immediately.',
  },
  otp_exercise_reminder_1d: {
    subject: 'Final Reminder: OTP Exercise Deadline Tomorrow',
    body: 'Final reminder: OTP exercise deadline is tomorrow. Please contact your buyer immediately.',
  },
  post_completion_day1: {
    subject: 'Congratulations on Completing Your Sale!',
    body: 'Congratulations on completing your sale! Thank you for choosing SellMyHomeNow.',
  },
  post_completion_day7: {
    subject: 'How Did Your Move Go?',
    body: "We hope your move went smoothly! We'd love to hear about your experience.",
  },
  post_completion_day14: {
    subject: 'Thinking of Your Next Property Move?',
    body: 'Thinking of your next property move? We can help with your next purchase.',
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
  otp_exercise_reminder_14d: 'pending',
  otp_exercise_reminder_7d: 'pending',
  otp_exercise_reminder_3d: 'pending',
  otp_exercise_reminder_1d: 'pending',
  post_completion_day1: 'pending',
  post_completion_day7: 'pending',
  post_completion_day14: 'pending',
  transaction_update: 'pending',
  document_ready: 'pending',
  invoice_uploaded: 'pending',
  agreement_sent: 'pending',
  financial_report_ready: 'pending',
  generic: 'pending',
};

// src/domains/admin/admin.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import * as adminRepo from './admin.repository';
import * as complianceService from '../compliance/compliance.service';
import * as authRepo from '@/domains/auth/auth.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as auditRepo from '@/domains/shared/audit.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import { HdbSyncService } from '@/domains/hdb/sync.service';
import { ConflictError, NotFoundError, ValidationError } from '@/domains/shared/errors';
import { SETTING_VALIDATORS } from './admin.validator';
import type {
  AdminLeadQueueResult,
  AdminSellerDetail,
  AgentCreateInput,
  AnalyticsData,
  AnalyticsFilter,
  HdbDataStatus,
  LeadListResult,
  ReviewItem,
  SettingGroup,
  SettingWithMeta,
} from './admin.types';
import type { SettingKey } from '@/domains/shared/settings.types';
import { getTimelineMilestones } from '@/domains/seller/seller.service';
import type { TimelineInput } from '@/domains/seller/seller.types';
import * as agentService from '@/domains/agent/agent.service';
import * as transactionService from '@/domains/transaction/transaction.service';
import * as viewingService from '@/domains/viewing/viewing.service';
import * as offerService from '@/domains/offer/offer.service';

// ─── Team Management ─────────────────────────────────────────

export async function getTeam() {
  return adminRepo.findAllAgents();
}

export async function getDefaultAgentId(): Promise<string | null> {
  const value = await settingsService.get('default_agent_id', '');
  return value || null;
}

export async function setDefaultAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);
  if (!agent.isActive) throw new ValidationError('Cannot set an inactive agent as default');

  await settingsService.upsert(
    'default_agent_id',
    agentId,
    'Default agent for new lead assignment',
    adminId,
  );

  await auditService.log({
    agentId: adminId,
    action: 'agent.set_as_default',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, setBy: adminId },
  });
}

export async function clearDefaultAgent(adminId: string): Promise<void> {
  await settingsService.upsert(
    'default_agent_id',
    '',
    'Default agent for new lead assignment',
    adminId,
  );
  await auditService.log({
    agentId: adminId,
    action: 'agent.default_cleared',
    entityType: 'agent',
    entityId: 'none',
    details: { clearedBy: adminId },
  });
}

export async function createAgent(
  input: AgentCreateInput,
  adminId: string,
): Promise<{ id: string; name: string; email: string }> {
  const existing = await adminRepo.findAgentByEmail(input.email);
  if (existing) {
    throw new ConflictError(`Email already in use: ${input.email}`);
  }

  const tempPassword = crypto.randomBytes(8).toString('hex'); // 16-char hex
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const agent = await adminRepo.createAgent({ ...input, passwordHash });

  await sendCredentialEmail(agent.email, agent.name, tempPassword);

  await auditService.log({
    agentId: adminId,
    action: 'agent.created',
    entityType: 'agent',
    entityId: agent.id,
    details: {
      name: agent.name,
      email: agent.email,
      ceaRegNo: input.ceaRegNo,
      createdBy: adminId,
    },
  });

  return agent;
}

async function sendCredentialEmail(
  email: string,
  name: string,
  tempPassword: string,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? 'noreply@sellmyhouse.sg';

  if (!host || !user || !pass) {
    // SMTP not configured (dev/test) — skip silently
    return;
  }

  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Your SellMyHouse Agent Account',
    text: [
      `Hi ${name},`,
      '',
      'Your agent account has been created on SellMyHouse.',
      '',
      `Email: ${email}`,
      `Temporary password: ${tempPassword}`,
      '',
      'Please log in and change your password immediately.',
      '',
      'SellMyHouse Team',
    ].join('\n'),
  });
}

export async function deactivateAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  const activeSellers = await adminRepo.countActiveSellers(agentId);
  if (activeSellers > 0) {
    throw new ValidationError(
      `Cannot deactivate agent with ${activeSellers} active seller(s). Reassign them first.`,
      { activeSellersCount: String(activeSellers) },
    );
  }

  await adminRepo.updateAgentStatus(agentId, false);
  await authRepo.invalidateUserSessions(agentId);

  await auditService.log({
    agentId: adminId,
    action: 'agent.deactivated',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, deactivatedBy: adminId, activeSellersCount: 0 },
  });
}

export async function reactivateAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  await adminRepo.updateAgentStatus(agentId, true);
  await authRepo.invalidateUserSessions(agentId);

  await auditService.log({
    agentId: adminId,
    action: 'agent.reactivated',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, reactivatedBy: adminId },
  });
}

export async function anonymiseAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);

  const activeSellers = await adminRepo.countActiveSellers(agentId);
  if (activeSellers > 0) {
    throw new ValidationError(
      `Cannot anonymise agent with ${activeSellers} active seller(s). Reassign them first.`,
      { activeSellersCount: String(activeSellers) },
    );
  }

  await adminRepo.anonymiseAgent(agentId);

  await auditService.log({
    agentId: adminId,
    action: 'agent.anonymised',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, anonymisedBy: adminId },
  });
}

export async function getAllSellers(filter: {
  agentId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  return adminRepo.findAllSellers(filter);
}

export async function getAdminSellerStatusCounts(): Promise<Record<string, number>> {
  return adminRepo.getAdminSellerStatusCounts();
}

export async function assignSeller(
  sellerId: string,
  newAgentId: string,
  adminId: string,
): Promise<void> {
  const seller = await adminRepo.findSellerById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const agent = await adminRepo.findAgentById(newAgentId);
  if (!agent || !agent.isActive) {
    throw new ValidationError('Target agent not found or inactive');
  }

  await adminRepo.assignSeller(sellerId, newAgentId);

  // Notify the new agent (in-app — fire and forget)
  void notificationService.createInAppNotification({
    recipientType: 'agent',
    recipientId: newAgentId,
    templateName: 'seller_assigned',
    content: `Seller ${seller.name} has been assigned to you.`,
  });

  await auditService.log({
    agentId: adminId,
    action: 'lead.assigned',
    entityType: 'seller',
    entityId: sellerId,
    details: { agentId: newAgentId, assignmentMethod: 'manual' },
  });
}

export async function reassignSeller(
  sellerId: string,
  newAgentId: string,
  adminId: string,
): Promise<void> {
  const seller = await adminRepo.findSellerById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const agent = await adminRepo.findAgentById(newAgentId);
  if (!agent || !agent.isActive) {
    throw new ValidationError('Target agent not found or inactive');
  }

  const fromAgentId = seller.agentId;
  await adminRepo.assignSeller(sellerId, newAgentId);

  // Notify both agents (in-app — fire and forget)
  void notificationService.createInAppNotification({
    recipientType: 'agent',
    recipientId: newAgentId,
    templateName: 'seller_reassigned',
    content: `Seller ${seller.name} has been reassigned to you.`,
  });
  if (fromAgentId) {
    void notificationService.createInAppNotification({
      recipientType: 'agent',
      recipientId: fromAgentId,
      templateName: 'seller_reassigned',
      content: `Seller ${seller.name} has been reassigned to another agent.`,
    });
  }

  await auditService.log({
    agentId: adminId,
    action: 'lead.reassigned',
    entityType: 'seller',
    entityId: sellerId,
    details: { fromAgentId, toAgentId: newAgentId, reason: 'admin_reassignment' },
  });
}

// ─── Leads ───────────────────────────────────────────────────

export async function getUnassignedLeads(page?: number): Promise<LeadListResult> {
  const currentPage = page ?? 1;
  const limit = 25;
  const [sellers, total] = await Promise.all([
    adminRepo.findUnassignedLeads(currentPage, limit),
    adminRepo.countUnassignedLeads(),
  ]);

  return {
    leads: sellers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
    })),
    total,
    page: currentPage,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getAdminLeadQueue(page?: number): Promise<AdminLeadQueueResult> {
  const [unassigned, allRaw] = await Promise.all([
    getUnassignedLeads(page),
    adminRepo.findAllLeads(),
  ]);

  return {
    unassigned,
    all: allRaw.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
    })),
  };
}

// ─── Review Queue ────────────────────────────────────────────

export async function getReviewQueue(): Promise<ReviewItem[]> {
  const { pendingListings, pendingReports } = await adminRepo.getReviewQueue();

  const items: ReviewItem[] = [
    ...pendingListings.map((p) => ({
      type: 'listing' as const,
      sellerId: p.property?.seller?.id,
      sellerName: p.property?.seller?.name,
      property: `${p.property?.block} ${p.property?.street}`,
      submittedAt: p.updatedAt,
      reviewUrl: `/agent/sellers/${p.property?.seller?.id}`,
    })),
    ...pendingReports.map((r) => ({
      type: 'report' as const,
      sellerId: r.seller?.id,
      sellerName: r.seller?.name,
      property: `${r.property?.block} ${r.property?.street}`,
      submittedAt: r.generatedAt,
      reviewUrl: `/agent/sellers/${r.seller?.id}`,
    })),
  ];

  return items.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}

// ─── Notifications ───────────────────────────────────────────

export async function getNotifications(filter: {
  channel?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}) {
  return notificationService.getNotifications({
    channel: filter.channel,
    status: filter.status,
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    page: filter.page,
    limit: 50,
  });
}

// ─── Settings ────────────────────────────────────────────────

export async function updateSetting(key: string, value: string, adminId: string): Promise<void> {
  const validator = SETTING_VALIDATORS[key as SettingKey];
  if (!validator) {
    throw new ValidationError(`Unknown setting key: ${key}`);
  }
  if (!validator(value)) {
    throw new ValidationError(`Invalid value for setting: ${key}`);
  }

  const existing = await settingsService.findByKey(key);
  const oldValue = existing?.value ?? null;

  await settingsService.upsert(key, value, `Setting: ${key}`, adminId);

  await auditService.log({
    agentId: adminId,
    action: 'setting.changed',
    entityType: 'setting',
    entityId: key,
    details: { key, oldValue, newValue: value, changedBy: adminId },
  });
}

export async function getSettingsGrouped(): Promise<SettingGroup[]> {
  const all = await settingsService.findAll();
  const map = new Map(all.map((s) => [s.key, s]));

  const CRON_KEYS = new Set(['market_content_schedule']);
  const TEXTAREA_KEYS = new Set(['listing_description_prompt']);

  const group = (label: string, keys: string[]): SettingGroup => ({
    label,
    settings: keys
      .map((k) => {
        const s = map.get(k);
        return s
          ? ({
              key: k,
              value: s.value,
              description: s.description,
              updatedAt: s.updatedAt,
              inputType: CRON_KEYS.has(k) ? 'cron' : TEXTAREA_KEYS.has(k) ? 'textarea' : 'text',
            } satisfies SettingWithMeta)
          : null;
      })
      .filter((s): s is SettingWithMeta => s !== null),
  });

  return [
    group('Pricing', ['commission_amount', 'gst_rate', 'display_price']),
    group('OTP & Transaction', ['otp_exercise_days', 'reminder_schedule']),
    group('Notifications', [
      'whatsapp_enabled',
      'email_enabled',
      'post_completion_thankyou_delay_days',
      'post_completion_testimonial_delay_days',
      'post_completion_buyer_followup_delay_days',
      'post_completion_referral_delay_days',
    ]),
    group('Data & Sync', [
      'hdb_sync_schedule',
      'lead_retention_months',
      'sensitive_doc_retention_days',
      'financial_data_retention_days',
      'transaction_anonymisation_days',
    ]),
    group('AI', [
      'ai_provider',
      'ai_model',
      'ai_max_tokens',
      'ai_temperature',
      'listing_description_prompt',
    ]),
    group('Platform', [
      'viewing_slot_duration',
      'viewing_max_group_size',
      'maintenance_mode',
      'market_content_schedule',
    ]),
  ];
}

// ─── Maintenance Mode ─────────────────────────────────────────

export interface MaintenanceSettings {
  isOn: boolean;
  message: string;
  eta: string;
}

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  const mode = await settingsService.get('maintenance_mode', 'false');
  if (mode !== 'true') {
    return { isOn: false, message: '', eta: '' };
  }
  const [message, eta] = await Promise.all([
    settingsService.get('maintenance_message', ''),
    settingsService.get('maintenance_eta', ''),
  ]);
  return { isOn: true, message, eta };
}

export async function toggleMaintenanceMode(agentId: string): Promise<boolean> {
  const current = await settingsService.get('maintenance_mode', 'false');
  const next = current === 'true' ? 'false' : 'true';
  // adminRepo.upsertSetting is used here (not settingsService.upsert) because maintenance
  // settings are ephemeral toggles that do not need a meaningful description string.
  await adminRepo.upsertSetting('maintenance_mode', next, agentId);
  await auditService.log({
    agentId,
    action: 'setting.changed',
    entityType: 'setting',
    entityId: 'maintenance_mode',
    details: { key: 'maintenance_mode', oldValue: current, newValue: next },
  });
  return next === 'true';
}

export async function setMaintenanceMessage(message: string, agentId: string): Promise<void> {
  // adminRepo.upsertSetting is used here (not settingsService.upsert) because maintenance
  // settings are ephemeral and do not require a description field.
  await adminRepo.upsertSetting('maintenance_message', message, agentId);
  await auditService.log({
    agentId,
    action: 'setting.changed',
    entityType: 'setting',
    entityId: 'maintenance_message',
    details: { key: 'maintenance_message', newValue: message },
  });
}

export async function setMaintenanceEta(eta: string, agentId: string): Promise<void> {
  // adminRepo.upsertSetting is used here (not settingsService.upsert) because maintenance
  // settings are ephemeral and do not require a description field.
  await adminRepo.upsertSetting('maintenance_eta', eta, agentId);
  await auditService.log({
    agentId,
    action: 'setting.changed',
    entityType: 'setting',
    entityId: 'maintenance_eta',
    details: { key: 'maintenance_eta', newValue: eta },
  });
}

// ─── HDB Management ──────────────────────────────────────────

export async function getHdbStatus(): Promise<HdbDataStatus> {
  return adminRepo.getHdbStatus();
}

export async function triggerHdbSync(adminId: string): Promise<void> {
  await auditService.log({
    agentId: adminId,
    action: 'hdb_sync.triggered_manually',
    entityType: 'hdbSync',
    entityId: 'manual',
    details: { triggeredBy: adminId },
  });

  // Fire-and-forget: sync runs async, HdbSyncService logs its own result
  const syncService = new HdbSyncService();
  syncService.sync().catch(() => {
    // HdbSyncService logs its own errors — nothing to do here
  });
}

export async function getDeletionQueue() {
  return complianceService.getDeletionQueue();
}

export async function approveDeletion(
  requestId: string,
  adminId: string,
  reviewNotes?: string,
): Promise<void> {
  await complianceService.executeHardDelete({ requestId, agentId: adminId, reviewNotes });
}

export async function anonymiseAgentOnDeparture(agentId: string, adminId: string): Promise<void> {
  await complianceService.anonymiseAgent({ agentId, requestedByAgentId: adminId });
}

// ─── Audit Log ───────────────────────────────────────────────

export async function getAuditLog(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  return auditRepo.findMany(filter);
}

export async function exportAuditLogCsv(
  filter: { action?: string; entityType?: string; dateFrom?: Date; dateTo?: Date },
  adminId: string,
) {
  const entries = await auditRepo.exportAll(filter);

  await auditService.log({
    agentId: adminId,
    action: 'audit_log.exported',
    entityType: 'AuditLog',
    entityId: 'bulk',
    details: { filter, entryCount: entries.length },
  });

  return entries;
}

// ─── Analytics ────────────────────────────────────────────────

export async function getAnalytics(filter: AnalyticsFilter): Promise<AnalyticsData> {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom) : defaultFrom;
  const dateTo = filter.dateTo ? new Date(filter.dateTo) : now;

  const [revenue, funnel, timeToClose, leadSources, viewings, referrals, commission] =
    await Promise.all([
      adminRepo.getRevenueMetrics(dateFrom, dateTo),
      adminRepo.getTransactionFunnel(dateFrom, dateTo),
      adminRepo.getTimeToClose(dateFrom, dateTo),
      adminRepo.getLeadSourceMetrics(dateFrom, dateTo),
      adminRepo.getViewingMetrics(dateFrom, dateTo),
      adminRepo.getReferralMetrics(dateFrom, dateTo),
      settingsService.getNumber('commission_total_with_gst', 1633.91),
    ]);

  return {
    revenue: {
      ...revenue,
      totalRevenue: Math.round(revenue.completedCount * commission * 100) / 100,
      commissionPerTransaction: commission,
    },
    funnel,
    timeToClose,
    leadSources,
    viewings,
    referrals,
  };
}

export async function getAdminSellerDetail(id: string): Promise<AdminSellerDetail> {
  const raw = await adminRepo.findSellerDetailForAdmin(id);
  if (!raw) throw new NotFoundError('Seller not found');

  const [cdd, auditLog, notificationsResult, eaa, transaction] = await Promise.all([
    complianceService.findLatestSellerCddRecord(id),
    auditRepo.findByEntity('seller', id),
    agentService.getNotificationHistory(id),
    complianceService.findEaaBySellerId(id),
    transactionService.findTransactionBySellerId(id),
  ]);

  const property = raw.properties[0] ?? null;

  const [firstViewingAt, otp, counterpartyCddRecord] = await Promise.all([
    property ? viewingService.findFirstViewingDateForProperty(property.id) : Promise.resolve(null),
    transaction ? transactionService.findOtpByTransactionId(transaction.id) : Promise.resolve(null),
    transaction
      ? complianceService.findCddRecordByTransactionAndSubjectType(transaction.id, 'counterparty')
      : Promise.resolve(null),
  ]);

  const acceptedOffer = transaction?.offerId
    ? await offerService.findOffer(transaction.offerId)
    : null;
  const isCoBroke = acceptedOffer?.isCoBroke ?? false;

  const timelineInput: TimelineInput = {
    sellerCddRecord: cdd ? { createdAt: cdd.createdAt } : null,
    eaa: eaa
      ? {
          videoCallConfirmedAt: eaa.videoCallConfirmedAt ?? null,
          signedCopyPath: eaa.signedCopyPath ?? null,
        }
      : null,
    property: property ? { status: property.status, listedAt: null } : null,
    firstViewingAt,
    acceptedOffer: acceptedOffer
      ? { createdAt: acceptedOffer.createdAt }
      : transaction
        ? { createdAt: transaction.createdAt }
        : null,
    counterpartyCddRecord:
      counterpartyCddRecord && !isCoBroke ? { createdAt: counterpartyCddRecord.createdAt } : null,
    isCoBroke,
    otp: otp
      ? {
          status: otp.status,
          agentReviewedAt: otp.agentReviewedAt ?? null,
          issuedAt: otp.issuedAt ?? null,
          exercisedAt: otp.exercisedAt ?? null,
        }
      : null,
    transaction: transaction
      ? {
          status: transaction.status,
          hdbApplicationStatus: transaction.hdbApplicationStatus,
          hdbAppSubmittedAt: transaction.hdbAppSubmittedAt ?? null,
          hdbAppApprovedAt: transaction.hdbAppApprovedAt ?? null,
          hdbAppointmentDate: transaction.hdbAppointmentDate ?? null,
          completionDate: transaction.completionDate ?? null,
        }
      : null,
  };
  const milestones = getTimelineMilestones(timelineInput, 'admin');

  return {
    seller: {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      phone: raw.phone,
      status: raw.status,
      notificationPreference: raw.notificationPreference,
      createdAt: raw.createdAt,
    },
    property: property
      ? {
          block: property.block,
          street: property.street,
          town: property.town,
          flatType: property.flatType,
          floorAreaSqm: property.floorAreaSqm,
          level: property.level,
          unitNumber: property.unitNumber,
          askingPrice: property.askingPrice ? property.askingPrice.toNumber() : null,
        }
      : null,
    agent: raw.agent,
    transaction: transaction
      ? {
          id: transaction.id,
          status: transaction.status,
          offerId: transaction.offerId,
          agreedPrice: transaction.agreedPrice.toNumber(),
          hdbApplicationStatus: transaction.hdbApplicationStatus,
          otpStatus: otp?.status ?? null,
          createdAt: transaction.createdAt,
        }
      : null,
    compliance: {
      cdd: cdd
        ? {
            riskLevel: cdd.riskLevel,
            identityVerified: cdd.identityVerified,
            verifiedAt: cdd.verifiedAt,
            createdAt: cdd.createdAt,
          }
        : null,
      consentCount: raw.consentRecords.length,
      hasWithdrawal: raw.consentRecords.some((c) => c.consentWithdrawnAt !== null),
    },
    auditLog: auditLog.slice(0, 20),
    milestones,
    notifications: notificationsResult.items,
  };
}

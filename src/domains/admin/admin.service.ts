// src/domains/admin/admin.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import * as adminRepo from './admin.repository';
import * as complianceService from '../compliance/compliance.service';
import * as auditService from '@/domains/shared/audit.service';
import * as auditRepo from '@/domains/shared/audit.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import { HdbSyncService } from '@/domains/hdb/sync.service';
import { ConflictError, NotFoundError, ValidationError } from '@/domains/shared/errors';
import { SETTING_VALIDATORS } from './admin.validator';
import type {
  AdminSellerDetail,
  AgentCreateInput,
  AdminPipelineResult,
  AdminPipelineStage,
  AnalyticsData,
  AnalyticsFilter,
  HdbDataStatus,
  LeadListResult,
  ReviewItem,
  SettingGroup,
  SettingWithMeta,
} from './admin.types';
import type { SettingKey } from '@/domains/shared/settings.types';

// ─── Team Management ─────────────────────────────────────────

export async function getTeam() {
  return adminRepo.findAllAgents();
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
  const from = process.env.SMTP_FROM ?? 'noreply@sellmyhomenow.sg';

  if (!host || !user || !pass) {
    // SMTP not configured (dev/test) — skip silently
    return;
  }

  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Your SellMyHomeNow Agent Account',
    text: [
      `Hi ${name},`,
      '',
      'Your agent account has been created on SellMyHomeNow.',
      '',
      `Email: ${email}`,
      `Temporary password: ${tempPassword}`,
      '',
      'Please log in and change your password immediately.',
      '',
      'SellMyHomeNow Team',
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

// ─── Pipeline ────────────────────────────────────────────────

export async function getAdminPipeline(stage?: string): Promise<AdminPipelineResult> {
  const sellers = await adminRepo.getPipelineForAdmin(stage);

  const stageMap = new Map<string, AdminPipelineStage>();
  const stageOrder = ['lead', 'engaged', 'active', 'completed', 'archived'];

  for (const s of sellers) {
    const key = s.status;
    if (!stageMap.has(key)) {
      stageMap.set(key, { status: key, count: 0, sellers: [] });
    }
    const stageEntry = stageMap.get(key)!;
    stageEntry.count++;
    stageEntry.sellers.push({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      agentName: s.agent?.name ?? null,
      askingPrice: s.properties[0]?.askingPrice ? Number(s.properties[0].askingPrice) : null,
      status: s.status,
    });
  }

  const stages = stageOrder
    .filter((status) => stageMap.has(status))
    .map((status) => stageMap.get(status)!);

  return { stages, totalSellers: sellers.length };
}

export async function getAdminPipelineCounts(): Promise<Record<string, number>> {
  const stageOrder = ['lead', 'engaged', 'active', 'completed', 'archived'];
  const counts = await Promise.all(
    stageOrder.map((status) => adminRepo.countPipelineStage(status)),
  );
  const result: Record<string, number> = {};
  stageOrder.forEach((status, i) => {
    result[status] = counts[i];
  });
  return result;
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
      'transaction_retention_years',
    ]),
    group('AI', ['ai_provider', 'ai_model', 'ai_max_tokens', 'ai_temperature']),
    group('Platform', [
      'viewing_slot_duration',
      'viewing_max_group_size',
      'maintenance_mode',
      'market_content_schedule',
    ]),
  ];
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

  const [cdd, auditLog] = await Promise.all([
    complianceService.findLatestSellerCddRecord(id),
    auditRepo.findByEntity('seller', id),
  ]);

  const property = raw.properties[0] ?? null;
  const transaction = raw.transactions[0] ?? null;

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
          storeyRange: property.storeyRange,
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
          otpStatus: transaction.otp?.status ?? null,
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
  };
}

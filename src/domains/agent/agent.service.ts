import * as agentRepo from './agent.repository';
import * as viewingService from '../viewing/viewing.service';
import * as complianceService from '../compliance/compliance.service';
import * as transactionService from '../transaction/transaction.service';
import { NotFoundError } from '@/domains/shared/errors';
import type {
  PipelineOverview,
  LeadQueueItem,
  LeadQueueResult,
  SellerListFilter,
  SellerListResult,
  SellerDetail,
  ComplianceStatus,
  NotificationHistoryResult,
} from './agent.types';
import type { TimelineInput } from '@/domains/seller/seller.types';

export async function getPipelineOverview(agentId?: string): Promise<PipelineOverview> {
  const [stages, recentActivity, pendingReviewCount, unassignedLeadCount] = await Promise.all([
    agentRepo.getPipelineStagesWithSellers(agentId),
    agentRepo.getRecentActivity(agentId),
    agentRepo.getPendingReviewCount(agentId),
    agentRepo.getUnassignedLeadCount(),
  ]);

  return {
    stages,
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      details: a.details as Record<string, unknown>,
      createdAt: a.createdAt,
    })),
    pendingReviewCount,
    unassignedLeadCount,
  };
}

export async function getLeadQueue(agentId?: string): Promise<LeadQueueResult> {
  const leads = await agentRepo.getLeadQueue(agentId);
  const sellerIds = leads.map((l) => l.id);
  const notificationMap = await agentRepo.getWelcomeNotificationStatus(sellerIds);

  const now = Date.now();
  const all: LeadQueueItem[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    emailVerified: lead.emailVerified,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt,
    timeSinceCreation: now - lead.createdAt.getTime(),
    welcomeNotificationSent: notificationMap.get(lead.id) ?? false,
    agentId: lead.agentId,
  }));

  const unassigned = all.filter((l) => l.agentId === null);
  const assigned = all.filter((l) => l.agentId !== null);
  const verified = assigned.filter((l) => l.emailVerified);
  const unverified = assigned.filter((l) => !l.emailVerified);

  return { unassigned, verified, unverified };
}

export async function getSellerList(
  filter: SellerListFilter,
  agentId?: string,
): Promise<SellerListResult> {
  const effectiveFilter = { ...filter };
  if (agentId) {
    effectiveFilter.agentId = agentId;
  }
  return agentRepo.getSellerList(effectiveFilter);
}

export async function getSellerDetail(sellerId: string, agentId?: string): Promise<SellerDetail> {
  const seller = await agentRepo.getSellerDetail(sellerId, agentId);
  if (!seller) {
    throw new NotFoundError('Seller', sellerId);
  }

  const property = seller.properties[0] ?? null;

  return {
    id: seller.id,
    name: seller.name,
    email: seller.email,
    phone: seller.phone,
    countryCode: seller.countryCode,
    nationalNumber: seller.nationalNumber,
    emailVerified: seller.emailVerified,
    sellingTimeline: seller.sellingTimeline,
    sellingReason: seller.sellingReason,
    sellingReasonOther: seller.sellingReasonOther,
    status: seller.status,
    leadSource: seller.leadSource,
    agentId: seller.agentId,
    onboardingStep: seller.onboardingStep,
    consentService: seller.consentService,
    consentMarketing: seller.consentMarketing,
    createdAt: seller.createdAt,
    updatedAt: seller.updatedAt,
    property: property
      ? {
          id: property.id,
          town: property.town,
          street: property.street,
          block: property.block,
          flatType: property.flatType,
          storeyRange: property.storeyRange,
          floorAreaSqm: property.floorAreaSqm,
          flatModel: property.flatModel,
          leaseCommenceDate: property.leaseCommenceDate,
          askingPrice: property.askingPrice ? Number(property.askingPrice) : null,
          priceHistory: property.priceHistory,
          status: property.status,
          listing: property.listings[0]
            ? {
                id: property.listings[0].id,
                status: property.listings[0].status,
                title: property.listings[0].title,
                description: property.listings[0].description,
              }
            : null,
        }
      : null,
  };
}

export async function getComplianceStatus(
  sellerId: string,
  agentId?: string,
): Promise<ComplianceStatus> {
  return agentRepo.getComplianceStatus(sellerId, agentId);
}

export async function getNotificationHistory(
  sellerId: string,
  agentId?: string,
  opts?: { page?: number; limit?: number },
): Promise<NotificationHistoryResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 10;
  const skip = (page - 1) * limit;

  const { items, total } = await agentRepo.getNotificationHistory(sellerId, agentId, {
    skip,
    take: limit,
  });
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items: items.map((n) => ({
      id: n.id,
      channel: n.channel,
      templateName: n.templateName,
      content: n.content,
      status: n.status,
      sentAt: n.sentAt,
      deliveredAt: n.deliveredAt,
      createdAt: n.createdAt,
    })),
    total,
    page,
    totalPages,
  };
}

export async function getTimelineInput(sellerId: string, agentId?: string): Promise<TimelineInput> {
  const [seller, compliance, transaction, cddRecord, eaa] = await Promise.all([
    agentRepo.getSellerDetail(sellerId, agentId),
    agentRepo.getComplianceStatus(sellerId, agentId),
    transactionService.findTransactionBySellerId(sellerId),
    complianceService.findLatestSellerCddRecord(sellerId),
    complianceService.findEaaBySellerId(sellerId),
  ]);

  const property = seller?.properties[0] ?? null;

  const [firstViewingAt, otp] = await Promise.all([
    property ? viewingService.findFirstViewingDateForProperty(property.id) : Promise.resolve(null),
    transaction ? transactionService.findOtpByTransactionId(transaction.id) : Promise.resolve(null),
  ]);

  const counterpartyCddRecord =
    compliance.counterpartyCdd?.transactionId && !compliance.counterpartyCdd.isCoBroke
      ? await complianceService.findCddRecordByTransactionAndSubjectType(
          compliance.counterpartyCdd.transactionId,
          'counterparty',
        )
      : null;

  return {
    sellerCddRecord: cddRecord ? { createdAt: cddRecord.createdAt } : null,
    eaa: eaa
      ? {
          videoCallConfirmedAt: eaa.videoCallConfirmedAt ?? null,
          signedCopyPath: eaa.signedCopyPath ?? null,
        }
      : null,
    property: property ? { status: property.status, listedAt: null } : null,
    firstViewingAt,
    acceptedOffer: transaction ? { createdAt: transaction.createdAt } : null,
    counterpartyCddRecord: counterpartyCddRecord
      ? { createdAt: counterpartyCddRecord.createdAt }
      : null,
    isCoBroke: compliance.counterpartyCdd?.isCoBroke ?? false,
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
}

export async function getRepeatViewers() {
  return viewingService.getRepeatViewers(2);
}

export async function processCorrectionRequest(input: {
  requestId: string;
  agentId: string;
  decision: 'approve' | 'reject';
  processNotes?: string;
}): Promise<void> {
  await complianceService.processCorrectionRequest(input);
}

export async function getSellerStatusCounts(agentId?: string): Promise<Record<string, number>> {
  return agentRepo.getSellerStatusCounts(agentId);
}

import * as agentRepo from './agent.repository';
import { NotFoundError } from '@/domains/shared/errors';
import type {
  PipelineOverview,
  LeadQueueItem,
  SellerListFilter,
  SellerListResult,
  SellerDetail,
  ComplianceStatus,
  NotificationHistoryItem,
} from './agent.types';
import type { TimelineMilestone } from '@/domains/seller/seller.types';
import { getTimelineMilestones } from '@/domains/seller/seller.service';

export async function getPipelineOverview(agentId?: string): Promise<PipelineOverview> {
  const [stages, recentActivity, pendingReviewCount] = await Promise.all([
    agentRepo.getPipelineStages(agentId),
    agentRepo.getRecentActivity(agentId),
    agentRepo.getPendingReviewCount(agentId),
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
  };
}

export async function getLeadQueue(agentId?: string): Promise<LeadQueueItem[]> {
  const leads = await agentRepo.getLeadQueue(agentId);
  const sellerIds = leads.map((l) => l.id);
  const notificationMap = await agentRepo.getWelcomeNotificationStatus(sellerIds);

  const now = Date.now();
  return leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt,
    timeSinceCreation: now - lead.createdAt.getTime(),
    welcomeNotificationSent: notificationMap.get(lead.id) ?? false,
  }));
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
): Promise<NotificationHistoryItem[]> {
  const notifications = await agentRepo.getNotificationHistory(sellerId, agentId);
  return notifications.map((n) => ({
    id: n.id,
    channel: n.channel,
    templateName: n.templateName,
    content: n.content,
    status: n.status,
    sentAt: n.sentAt,
    deliveredAt: n.deliveredAt,
    createdAt: n.createdAt,
  }));
}

export function getTimeline(
  propertyStatus: string | null,
  transactionStatus: string | null,
): TimelineMilestone[] {
  return getTimelineMilestones(propertyStatus, transactionStatus);
}

import * as reviewRepo from './review.repository';
import * as complianceRepo from '@/domains/compliance/compliance.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import { ValidationError, ComplianceError, NotFoundError, ForbiddenError } from '@/domains/shared/errors';
import {
  REVIEW_TRANSITIONS,
  WEEKLY_UPDATE_TRANSITIONS,
  DOCUMENT_CHECKLIST_TRANSITIONS,
} from './review.types';
import type { EntityType, ComplianceGate, ReviewStatus } from './review.types';

export function validateTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  entityType: EntityType,
): void {
  let allowed: ReviewStatus[];
  if (entityType === 'weekly_update') {
    allowed = (WEEKLY_UPDATE_TRANSITIONS as Record<string, ReviewStatus[]>)[from] ?? [];
  } else if (entityType === 'document_checklist') {
    allowed = (DOCUMENT_CHECKLIST_TRANSITIONS as Record<string, ReviewStatus[]>)[from] ?? [];
  } else {
    allowed = (REVIEW_TRANSITIONS as Record<string, ReviewStatus[]>)[from] ?? [];
  }
  if (!allowed.includes(to)) {
    throw new ValidationError(`Cannot transition from '${from}' to '${to}'`);
  }
}

export async function checkComplianceGate(
  gate: ComplianceGate,
  sellerId: string,
  _context?: { buyerRepresented?: boolean },
): Promise<void> {
  switch (gate) {
    case 'cdd_complete': {
      const cdd = await reviewRepo.findVerifiedSellerCdd(sellerId);
      if (!cdd) {
        throw new ComplianceError('Seller CDD must be verified before this action');
      }
      break;
    }
    case 'eaa_signed': {
      const eaa = await reviewRepo.findActiveEaa(sellerId);
      if (!eaa) {
        throw new ComplianceError('EAA must be signed or active before listing can go live');
      }
      break;
    }
    case 'counterparty_cdd': {
      // sellerId parameter is used as transactionId for this gate
      const cddRecord = await complianceRepo.findCddRecordByTransactionAndSubjectType(
        sellerId,
        'counterparty',
      );
      if (!cddRecord || !cddRecord.verifiedAt) {
        throw new ComplianceError(
          'Gate 3: Counterparty CDD must be completed before proceeding',
        );
      }
      return;
    }
    case 'agent_otp_review':
      // No-op stub — wired in future SP when transaction service is built
      return;
  }
}

export async function getPendingQueue(agentId?: string) {
  return reviewRepo.getPendingQueue(agentId);
}

export async function getDetailForReview(entityType: EntityType, entityId: string) {
  const detail = await reviewRepo.getDetailForReview(entityType, entityId);
  if (!detail) throw new NotFoundError(entityType, entityId);
  return detail;
}

/** Fetch current status for entity types that have an explicit status field */
async function getCurrentStatus(entityType: EntityType, entityId: string): Promise<ReviewStatus> {
  // Listing types use timestamp-based state — assume pending_review when they appear in queue
  if (entityType === 'listing_description' || entityType === 'listing_photos') {
    return 'pending_review';
  }
  const detail = await reviewRepo.getDetailForReview(entityType, entityId);
  if (!detail) throw new NotFoundError(entityType, entityId);
  return (detail as { status: ReviewStatus }).status;
}

const AUDIT_ACTION: Record<EntityType, string> = {
  financial_report: 'financial_report.reviewed',
  listing_description: 'listing.reviewed',
  listing_photos: 'listing.reviewed',
  weekly_update: 'weekly_update.reviewed',
  market_content: 'market_content.reviewed',
  document_checklist: 'document_checklist.reviewed',
};

/** For listing entity types, verify the calling agent is assigned to the listing's seller. */
async function assertListingOwnership(
  entityType: EntityType,
  entityId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<void> {
  if (callerRole === 'admin') return;
  if (entityType !== 'listing_description' && entityType !== 'listing_photos') return;
  const assignedAgentId = await reviewRepo.getListingAgentId(entityId);
  if (assignedAgentId !== callerAgentId) {
    throw new ForbiddenError('You are not authorised to review this listing');
  }
}

export async function approveItem(input: {
  entityType: EntityType;
  entityId: string;
  agentId: string;
  callerRole?: string;
}): Promise<void> {
  const { entityType, entityId, agentId, callerRole = 'agent' } = input;

  await assertListingOwnership(entityType, entityId, agentId, callerRole);

  const currentStatus = await getCurrentStatus(entityType, entityId);
  validateTransition(currentStatus, 'approved', entityType);

  switch (entityType) {
    case 'financial_report':
      await reviewRepo.approveFinancialReport(entityId, agentId);
      break;
    case 'listing_description': {
      await reviewRepo.approveListingDescription(entityId, agentId);
      const isFullyApprovedDesc = await reviewRepo.checkListingFullyApproved(entityId);
      if (isFullyApprovedDesc) {
        await reviewRepo.setListingStatus(entityId, 'approved');
        await portalService.generatePortalListings(entityId);
      }
      break;
    }
    case 'listing_photos': {
      await reviewRepo.approveListingPhotos(entityId, agentId);
      const isFullyApprovedPhotos = await reviewRepo.checkListingFullyApproved(entityId);
      if (isFullyApprovedPhotos) {
        await reviewRepo.setListingStatus(entityId, 'approved');
        await portalService.generatePortalListings(entityId);
      }
      break;
    }
    case 'weekly_update':
      await reviewRepo.approveWeeklyUpdate(entityId, agentId);
      break;
    case 'market_content':
      await reviewRepo.approveMarketContent(entityId, agentId);
      break;
    case 'document_checklist':
      await reviewRepo.approveDocumentChecklist(entityId, agentId);
      break;
  }

  await auditService.log({
    agentId,
    action: AUDIT_ACTION[entityType],
    entityType,
    entityId,
    details: { decision: 'approved' },
  });
}

export async function rejectItem(input: {
  entityType: EntityType;
  entityId: string;
  agentId: string;
  reviewNotes: string;
  callerRole?: string;
}): Promise<void> {
  const { entityType, entityId, agentId, reviewNotes, callerRole = 'agent' } = input;

  await assertListingOwnership(entityType, entityId, agentId, callerRole);

  if (!reviewNotes || reviewNotes.trim() === '') {
    throw new ValidationError('Rejection notes are required');
  }

  const currentStatus = await getCurrentStatus(entityType, entityId);
  validateTransition(currentStatus, 'rejected', entityType);

  switch (entityType) {
    case 'financial_report':
      await reviewRepo.rejectFinancialReport(entityId, agentId, reviewNotes);
      break;
    case 'listing_description':
      await reviewRepo.rejectListingDescription(entityId, agentId, reviewNotes);
      break;
    case 'listing_photos':
      await reviewRepo.rejectListingPhotos(entityId, agentId, reviewNotes);
      break;
    case 'weekly_update':
      await reviewRepo.rejectWeeklyUpdate(entityId, agentId, reviewNotes);
      break;
    case 'market_content':
      await reviewRepo.rejectMarketContent(entityId, agentId, reviewNotes);
      break;
    case 'document_checklist':
      await reviewRepo.rejectDocumentChecklist(entityId, agentId, reviewNotes);
      break;
  }

  await auditService.log({
    agentId,
    action: AUDIT_ACTION[entityType],
    entityType,
    entityId,
    details: { decision: 'rejected', reviewNotes },
  });
}

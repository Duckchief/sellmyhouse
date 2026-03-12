// src/domains/seller/case-flag.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as caseFlagRepo from './case-flag.repository';
import * as sellerRepo from './seller.repository';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError } from '@/domains/shared/errors';
import { CASE_FLAG_CHECKLISTS } from './case-flag.types';
import type { CreateCaseFlagInput, UpdateCaseFlagInput, CaseFlagType } from './case-flag.types';

export async function createCaseFlag(input: CreateCaseFlagInput) {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  const flag = await caseFlagRepo.create({
    id: createId(),
    sellerId: input.sellerId,
    flagType: input.flagType,
    description: input.description,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'case_flag.created',
    entityType: 'case_flag',
    entityId: flag.id,
    details: { sellerId: input.sellerId, flagType: input.flagType },
  });

  return flag;
}

export async function updateCaseFlag(input: UpdateCaseFlagInput) {
  const flag = await caseFlagRepo.findById(input.flagId);
  if (!flag) throw new NotFoundError('CaseFlag', input.flagId);

  const updated = await caseFlagRepo.updateStatus(
    input.flagId,
    input.status,
    input.guidanceProvided,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'case_flag.updated',
    entityType: 'case_flag',
    entityId: input.flagId,
    details: { newStatus: input.status },
  });

  return updated;
}

export async function getCaseFlagsForSeller(sellerId: string) {
  return caseFlagRepo.findBySellerId(sellerId);
}

export function getChecklistForType(flagType: CaseFlagType): string[] {
  return CASE_FLAG_CHECKLISTS[flagType];
}

export async function hasActiveMopFlag(sellerId: string): Promise<boolean> {
  const flag = await caseFlagRepo.findActiveMopFlag(sellerId);
  return flag !== null;
}

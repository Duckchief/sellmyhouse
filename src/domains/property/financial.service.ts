import { createId } from '@paralleldrive/cuid2';
import * as financialRepo from './financial.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import { AIUnavailableError } from '@/domains/shared/ai/ai.facade';
import * as auditService from '@/domains/shared/audit.service';
import { logger } from '@/infra/logger';
import * as notificationService from '@/domains/notification/notification.service';
import { calculateNetProceeds } from './financial.calculator';
import { buildFinancialNarrativePrompt } from '@/domains/shared/ai/prompts/financial-narrative';
import { NotFoundError, ValidationError, ForbiddenError } from '@/domains/shared/errors';
import type {
  CreateReportInput,
  ApproveReportInput,
  SendReportInput,
  FinancialReportData,
} from './financial.types';

export async function calculateAndCreateReport(input: CreateReportInput) {
  const commission = await settingsService.getCommission();
  const currentYear = new Date().getFullYear();

  const outputs = calculateNetProceeds(input.calculationInput, commission.total, currentYear);

  // Determine version
  const latest = await financialRepo.findLatestForProperty(input.sellerId, input.propertyId);
  const version = latest ? latest.version + 1 : 1;

  const reportData: FinancialReportData = {
    inputs: input.calculationInput,
    outputs,
    metadata: {
      ...input.metadata,
      calculatedAt: new Date().toISOString(),
    },
  };

  const id = createId();
  const report = await financialRepo.create({
    id,
    sellerId: input.sellerId,
    propertyId: input.propertyId,
    reportData,
    version,
  });

  await auditService.log({
    action: 'financial.report_generated',
    entityType: 'financial_report',
    entityId: id,
    details: { version, sellerId: input.sellerId, propertyId: input.propertyId },
  });

  return report;
}

export async function generateNarrative(reportId: string) {
  const report = await financialRepo.findById(reportId);
  if (!report) throw new NotFoundError('FinancialReport', reportId);

  const reportData = report.reportData as unknown as FinancialReportData;
  const prompt = buildFinancialNarrativePrompt(reportData.outputs, {
    town: reportData.metadata.town,
    flatType: reportData.metadata.flatType,
  });

  try {
    const result = await aiFacade.generateText(prompt);

    await financialRepo.updateNarrative(reportId, {
      aiNarrative: result.text,
      aiProvider: result.provider,
      aiModel: result.model,
    });

    await auditService.log({
      action: 'financial.narrative_generated',
      entityType: 'financial_report',
      entityId: reportId,
      details: { provider: result.provider, model: result.model },
    });
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      // Graceful degradation: mark report as needing manual narrative
      logger.warn({ reportId, err }, 'AI unavailable for financial narrative — agent must write manually');
      await financialRepo.updateNarrative(reportId, {
        aiNarrative: '',
        aiProvider: 'unavailable',
        aiModel: 'none',
      });
      await auditService.log({
        action: 'financial.narrative_ai_unavailable',
        entityType: 'financial_report',
        entityId: reportId,
        details: { error: err.message },
      });
      // Don't rethrow — report moves to pending_review, agent writes narrative manually
      return;
    }
    throw err;
  }
}

export async function approveReport(input: ApproveReportInput) {
  const report = await financialRepo.findById(input.reportId);
  if (!report) throw new NotFoundError('FinancialReport', input.reportId);

  if (!report.aiNarrative) {
    throw new ValidationError('Report has no AI narrative and cannot be approved yet');
  }
  if (report.sentToSellerAt) {
    throw new ValidationError('Report has already been sent and cannot be re-approved');
  }

  await financialRepo.approve(input.reportId, input.agentId, input.reviewNotes);

  await auditService.log({
    action: 'financial.report_approved',
    entityType: 'financial_report',
    entityId: input.reportId,
    details: { agentId: input.agentId, reviewNotes: input.reviewNotes },
  });
}

export async function sendReport(input: SendReportInput) {
  const report = await financialRepo.findById(input.reportId);
  if (!report) throw new NotFoundError('FinancialReport', input.reportId);

  if (!report.approvedAt) {
    throw new ValidationError('Report must be approved before it can be sent');
  }
  if (report.sentToSellerAt) {
    throw new ValidationError('Report has already been sent');
  }

  const reportData = report.reportData as unknown as FinancialReportData;

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: report.sellerId,
      templateName: 'financial_report_ready',
      templateData: {
        address: `${reportData.metadata.flatType} in ${reportData.metadata.town}`,
        message: `Your financial report (v${report.version}) is ready. Log in to view your estimated net proceeds.`,
      },
      preferredChannel: input.channel,
    },
    input.agentId,
  );

  await financialRepo.markSent(input.reportId, input.channel);

  await auditService.log({
    action: 'financial.report_sent',
    entityType: 'financial_report',
    entityId: input.reportId,
    details: { channel: input.channel, sellerId: report.sellerId },
  });
}

export async function getReport(reportId: string) {
  const report = await financialRepo.findById(reportId);
  if (!report) throw new NotFoundError('FinancialReport', reportId);
  return report;
}

export async function getReportForSeller(reportId: string, sellerId: string) {
  const report = await financialRepo.findById(reportId);
  if (!report) throw new NotFoundError('FinancialReport', reportId);
  if (report.sellerId !== sellerId) throw new ForbiddenError('You do not own this report');
  return report;
}

export async function acknowledgeDisclaimer(reportId: string, sellerId: string) {
  const report = await financialRepo.findById(reportId);
  if (!report) throw new NotFoundError('FinancialReport', reportId);
  if (report.sellerId !== sellerId) throw new ForbiddenError('You do not own this report');

  // Idempotent: if already acknowledged, return as-is
  if (report.disclaimerAcknowledgedAt) return report;

  const updated = await financialRepo.acknowledgeDisclaimer(reportId);

  await auditService.log({
    action: 'financial_report.disclaimer_acknowledged',
    entityType: 'financial_report',
    entityId: reportId,
    details: { sellerId, acknowledgedAt: updated.disclaimerAcknowledgedAt },
  });

  return updated;
}

export async function getReportsForSeller(sellerId: string) {
  return financialRepo.findAllForSeller(sellerId);
}

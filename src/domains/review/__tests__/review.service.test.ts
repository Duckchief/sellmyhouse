import {
  validateTransition,
  checkComplianceGate,
  approveItem,
  rejectItem,
} from '../review.service';
import {
  ValidationError,
  ComplianceError,
  ForbiddenError,
  NotFoundError,
} from '@/domains/shared/errors';
import * as reviewRepo from '../review.repository';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as transactionService from '@/domains/transaction/transaction.service';
import * as portalService from '@/domains/property/portal.service';
import * as auditService from '@/domains/shared/audit.service';

jest.mock('../review.repository');
jest.mock('@/domains/property/portal.service');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/compliance/compliance.service');
jest.mock('@/domains/transaction/transaction.service');
const mockRepo = reviewRepo as jest.Mocked<typeof reviewRepo>;
const mockComplianceService = complianceService as jest.Mocked<typeof complianceService>;
const mockTransactionService = transactionService as jest.Mocked<typeof transactionService>;
const mockPortalService = portalService as jest.Mocked<typeof portalService>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;

describe('validateTransition', () => {
  it('allows draft → ai_generated', () => {
    expect(() => validateTransition('draft', 'ai_generated', 'financial_report')).not.toThrow();
  });

  it('allows pending_review → approved', () => {
    expect(() =>
      validateTransition('pending_review', 'approved', 'financial_report'),
    ).not.toThrow();
  });

  it('allows pending_review → rejected', () => {
    expect(() =>
      validateTransition('pending_review', 'rejected', 'financial_report'),
    ).not.toThrow();
  });

  it('allows approved → sent for financial_report', () => {
    expect(() => validateTransition('approved', 'sent', 'financial_report')).not.toThrow();
  });

  it('blocks approved → sent for document_checklist', () => {
    expect(() => validateTransition('approved', 'sent', 'document_checklist')).toThrow(
      ValidationError,
    );
  });

  it('blocks sent → anything (terminal state)', () => {
    expect(() => validateTransition('sent', 'approved', 'financial_report')).toThrow(
      ValidationError,
    );
    expect(() => validateTransition('sent', 'pending_review', 'financial_report')).toThrow(
      ValidationError,
    );
  });

  it('blocks invalid transition draft → sent', () => {
    expect(() => validateTransition('draft', 'sent', 'financial_report')).toThrow(ValidationError);
  });

  it('blocks invalid transition ai_generated → approved', () => {
    expect(() => validateTransition('ai_generated', 'approved', 'financial_report')).toThrow(
      ValidationError,
    );
  });

  it('allows rejected → ai_generated (regenerate)', () => {
    expect(() => validateTransition('rejected', 'ai_generated', 'financial_report')).not.toThrow();
  });

  it('allows rejected → pending_review (re-review)', () => {
    expect(() =>
      validateTransition('rejected', 'pending_review', 'financial_report'),
    ).not.toThrow();
  });
});

describe('checkComplianceGate - eaa_signed', () => {
  it('passes when EAA status is signed', async () => {
    mockRepo.findActiveEaa.mockResolvedValue({ id: '1', status: 'signed' } as unknown as Awaited<
      ReturnType<typeof reviewRepo.findActiveEaa>
    >);
    await expect(checkComplianceGate('eaa_signed', 'seller-1')).resolves.toBeUndefined();
  });

  it('passes when EAA status is active', async () => {
    mockRepo.findActiveEaa.mockResolvedValue({ id: '1', status: 'active' } as unknown as Awaited<
      ReturnType<typeof reviewRepo.findActiveEaa>
    >);
    await expect(checkComplianceGate('eaa_signed', 'seller-1')).resolves.toBeUndefined();
  });

  it('throws ComplianceError when EAA record exists but has draft status', async () => {
    mockRepo.findActiveEaa.mockResolvedValue(null);
    await expect(checkComplianceGate('eaa_signed', 'seller-1')).rejects.toThrow(ComplianceError);
  });

  it('throws ComplianceError when no EAA exists', async () => {
    mockRepo.findActiveEaa.mockResolvedValue(null);
    await expect(checkComplianceGate('eaa_signed', 'seller-1')).rejects.toThrow(
      'EAA must be signed or active before listing can go live',
    );
  });
});

describe('checkComplianceGate - counterparty_cdd', () => {
  it('throws ComplianceError when no counterparty CDD record exists', async () => {
    mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue(null);
    await expect(checkComplianceGate('counterparty_cdd', 'tx-1')).rejects.toThrow(ComplianceError);
  });

  it('throws ComplianceError when CDD record exists but is not verified', async () => {
    mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue({
      id: 'cdd-1',
      verifiedAt: null,
    } as never);
    await expect(checkComplianceGate('counterparty_cdd', 'tx-1')).rejects.toThrow(ComplianceError);
  });

  it('passes when counterparty CDD record is verified', async () => {
    mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue({
      id: 'cdd-1',
      verifiedAt: new Date(),
    } as never);
    await expect(checkComplianceGate('counterparty_cdd', 'tx-1')).resolves.toBeUndefined();
  });
});

describe('checkComplianceGate - agent_otp_review (future SP)', () => {
  it('agent_otp_review is a no-op pass-through (wired in future SP)', async () => {
    await expect(checkComplianceGate('agent_otp_review', 'seller-1')).resolves.toBeUndefined();
  });
});

describe('checkComplianceGate - hdb_complete (Gate 5)', () => {
  it('throws NotFoundError when transaction is not found', async () => {
    mockTransactionService.findTransactionById.mockResolvedValue(null);
    await expect(checkComplianceGate('hdb_complete', 'tx-missing')).rejects.toThrow(NotFoundError);
  });

  it('throws ComplianceError when hdbApplicationStatus is not approval_granted', async () => {
    mockTransactionService.findTransactionById.mockResolvedValue({
      id: 'tx-1',
      hdbApplicationStatus: 'application_submitted',
    } as never);
    await expect(checkComplianceGate('hdb_complete', 'tx-1')).rejects.toThrow(ComplianceError);
  });

  it('throws ComplianceError when hdbApplicationStatus is null', async () => {
    mockTransactionService.findTransactionById.mockResolvedValue({
      id: 'tx-1',
      hdbApplicationStatus: null,
    } as never);
    await expect(checkComplianceGate('hdb_complete', 'tx-1')).rejects.toThrow(ComplianceError);
  });

  it('passes when hdbApplicationStatus is approval_granted', async () => {
    mockTransactionService.findTransactionById.mockResolvedValue({
      id: 'tx-1',
      hdbApplicationStatus: 'approval_granted',
    } as never);
    await expect(checkComplianceGate('hdb_complete', 'tx-1')).resolves.toBeUndefined();
  });
});

describe('checkComplianceGate - cdd_complete', () => {
  it('passes when seller CDD is verified', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue({
      id: '1',
      identityVerified: true,
    } as unknown as Awaited<ReturnType<typeof reviewRepo.findVerifiedSellerCdd>>);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).resolves.toBeUndefined();
  });

  it('throws ComplianceError when no verified CDD exists', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue(null);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).rejects.toThrow(ComplianceError);
  });

  it('throws ComplianceError when CDD is enhanced risk but notes are missing', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue({
      id: '1',
      identityVerified: true,
      riskLevel: 'enhanced',
      notes: null,
    } as never);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).rejects.toThrow(ComplianceError);
  });

  it('throws ComplianceError when CDD is enhanced risk but notes are too short', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue({
      id: '1',
      identityVerified: true,
      riskLevel: 'enhanced',
      notes: 'ok',
    } as never);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).rejects.toThrow(ComplianceError);
  });

  it('passes when CDD is enhanced risk with sufficient notes', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue({
      id: '1',
      identityVerified: true,
      riskLevel: 'enhanced',
      notes:
        'PEP screening completed. Seller is a former senior civil servant. Source of funds verified via CPF statements and bank records.',
    } as never);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).resolves.toBeUndefined();
  });

  it('passes when CDD is standard risk without notes', async () => {
    mockRepo.findVerifiedSellerCdd.mockResolvedValue({
      id: '1',
      identityVerified: true,
      riskLevel: 'standard',
      notes: null,
    } as never);
    await expect(checkComplianceGate('cdd_complete', 'seller-1')).resolves.toBeUndefined();
  });
});

describe('checkComplianceGate - hdb_submission_review', () => {
  it('passes when OTP is exercised', async () => {
    mockTransactionService.findTransactionBySellerId.mockResolvedValue({ id: 'tx-1' } as never);
    mockTransactionService.findOtpByTransactionId.mockResolvedValue({
      id: 'otp-1',
      status: 'exercised',
    } as never);

    await expect(checkComplianceGate('hdb_submission_review', 'seller-1')).resolves.toBeUndefined();
  });

  it('throws ComplianceError when OTP is not exercised', async () => {
    mockTransactionService.findTransactionBySellerId.mockResolvedValue({ id: 'tx-1' } as never);
    mockTransactionService.findOtpByTransactionId.mockResolvedValue({
      id: 'otp-1',
      status: 'issued_to_buyer',
    } as never);

    await expect(checkComplianceGate('hdb_submission_review', 'seller-1')).rejects.toThrow(
      ComplianceError,
    );
  });

  it('throws ComplianceError when no transaction exists', async () => {
    mockTransactionService.findTransactionBySellerId.mockResolvedValue(null);

    await expect(checkComplianceGate('hdb_submission_review', 'seller-1')).rejects.toThrow(
      ComplianceError,
    );
  });

  it('throws ComplianceError when no OTP exists for transaction', async () => {
    mockTransactionService.findTransactionBySellerId.mockResolvedValue({ id: 'tx-1' } as never);
    mockTransactionService.findOtpByTransactionId.mockResolvedValue(null);

    await expect(checkComplianceGate('hdb_submission_review', 'seller-1')).rejects.toThrow(
      ComplianceError,
    );
  });
});

describe('approveItem — listing portal generation hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.approveListingDescription.mockResolvedValue({} as never);
    mockRepo.approveListingPhotos.mockResolvedValue({} as never);
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);
    mockRepo.setListingStatus.mockResolvedValue({} as never);
    mockPortalService.generatePortalListings.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined as never);
    // Ownership check: default to listing assigned to agent-1
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');
  });

  it('generates portal listings when listing_description approval makes listing fully approved', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(true);

    await approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).toHaveBeenCalledWith('listing-1');
    expect(mockRepo.setListingStatus).toHaveBeenCalledWith('listing-1', 'approved');
  });

  it('does NOT generate portal listings when only description approved (photos pending)', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);

    await approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).not.toHaveBeenCalled();
  });

  it('generates portal listings when listing_photos approval makes listing fully approved', async () => {
    mockRepo.checkListingFullyApproved.mockResolvedValue(true);

    await approveItem({
      entityType: 'listing_photos',
      entityId: 'listing-1',
      agentId: 'agent-1',
    });

    expect(mockPortalService.generatePortalListings).toHaveBeenCalledWith('listing-1');
    expect(mockRepo.setListingStatus).toHaveBeenCalledWith('listing-1', 'approved');
  });
});

describe('approveItem — ownership enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.approveListingDescription.mockResolvedValue({} as never);
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);
    mockAudit.log.mockResolvedValue(undefined as never);
  });

  it('throws ForbiddenError when agent approves listing assigned to another agent', async () => {
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');

    await expect(
      approveItem({
        entityType: 'listing_description',
        entityId: 'listing-1',
        agentId: 'agent-2',
        callerRole: 'agent',
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(mockRepo.approveListingDescription).not.toHaveBeenCalled();
  });

  it('admin can approve any listing regardless of agent assignment', async () => {
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');

    await expect(
      approveItem({
        entityType: 'listing_description',
        entityId: 'listing-1',
        agentId: 'admin-user',
        callerRole: 'admin',
      }),
    ).resolves.toBeUndefined();

    expect(mockRepo.approveListingDescription).toHaveBeenCalledWith('listing-1', 'admin-user');
  });

  it('ownership check is skipped for non-listing entity types', async () => {
    mockRepo.approveFinancialReport.mockResolvedValue({} as never);
    mockRepo.getDetailForReview.mockResolvedValue({ status: 'pending_review' } as never);

    await expect(
      approveItem({
        entityType: 'financial_report',
        entityId: 'report-1',
        agentId: 'agent-99',
        callerRole: 'agent',
      }),
    ).resolves.toBeUndefined();

    expect(mockRepo.getListingAgentId).not.toHaveBeenCalled();
  });
});

describe('rejectItem — ownership enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.rejectListingDescription.mockResolvedValue({} as never);
    mockAudit.log.mockResolvedValue(undefined as never);
  });

  it('throws ForbiddenError when agent rejects listing assigned to another agent', async () => {
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');

    await expect(
      rejectItem({
        entityType: 'listing_description',
        entityId: 'listing-1',
        agentId: 'agent-2',
        reviewNotes: 'Not good enough',
        callerRole: 'agent',
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(mockRepo.rejectListingDescription).not.toHaveBeenCalled();
  });

  it('admin can reject any listing regardless of agent assignment', async () => {
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');

    await expect(
      rejectItem({
        entityType: 'listing_description',
        entityId: 'listing-1',
        agentId: 'admin-user',
        reviewNotes: 'Needs revision',
        callerRole: 'admin',
      }),
    ).resolves.toBeUndefined();

    expect(mockRepo.rejectListingDescription).toHaveBeenCalledWith(
      'listing-1',
      'admin-user',
      'Needs revision',
    );
  });
});

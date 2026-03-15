import { Prisma } from '@prisma/client';
import { testPrisma } from '../helpers/prisma';
import { createId } from '@paralleldrive/cuid2';
import { encrypt } from '../../src/domains/shared/encryption';

export const factory = {
  async systemSetting(overrides: { key: string; value: string; description?: string }) {
    return testPrisma.systemSetting.create({
      data: {
        id: createId(),
        key: overrides.key,
        value: overrides.value,
        description: overrides.description || `Setting: ${overrides.key}`,
      },
    });
  },

  async auditLog(overrides: {
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    agentId?: string;
  }) {
    return testPrisma.auditLog.create({
      data: {
        id: createId(),
        action: overrides.action,
        entityType: overrides.entityType,
        entityId: overrides.entityId,
        details: (overrides.details || {}) as Prisma.InputJsonValue,
        agentId: overrides.agentId,
      },
    });
  },

  async agent(overrides?: {
    name?: string;
    email?: string;
    phone?: string;
    ceaRegNo?: string;
    passwordHash?: string;
    role?: 'admin' | 'agent';
    isActive?: boolean;
    notificationPreference?: 'whatsapp_and_email' | 'email_only';
  }) {
    const id = createId();
    return testPrisma.agent.create({
      data: {
        id,
        name: overrides?.name ?? 'Test Agent',
        email: overrides?.email ?? `agent-${id}@test.local`,
        phone: overrides?.phone ?? `9${id.slice(0, 7)}`,
        ceaRegNo: overrides?.ceaRegNo ?? `R${id.slice(0, 6)}A`,
        passwordHash: overrides?.passwordHash ?? '$2b$12$placeholder.hash.for.testing.only',
        role: overrides?.role ?? 'agent',
        isActive: overrides?.isActive ?? true,
        notificationPreference: overrides?.notificationPreference ?? 'whatsapp_and_email',
      },
    });
  },

  async seller(overrides?: {
    name?: string;
    email?: string;
    phone?: string;
    passwordHash?: string;
    agentId?: string;
    status?: 'lead' | 'engaged' | 'active' | 'completed' | 'archived';
    consentService?: boolean;
    consentMarketing?: boolean;
    leadSource?: 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';
    onboardingStep?: number;
  }) {
    const id = createId();
    return testPrisma.seller.create({
      data: {
        id,
        name: overrides?.name ?? 'Test Seller',
        email: overrides?.email ?? `seller-${id}@test.local`,
        phone: overrides?.phone ?? `8${id.slice(0, 7)}`,
        passwordHash: overrides?.passwordHash ?? null,
        agentId: overrides?.agentId,
        status: overrides?.status ?? 'lead',
        consentService: overrides?.consentService ?? true,
        consentMarketing: overrides?.consentMarketing ?? false,
        leadSource: overrides?.leadSource ?? 'website',
        onboardingStep: overrides?.onboardingStep ?? 0,
      },
    });
  },

  async property(overrides: {
    sellerId: string;
    town?: string;
    street?: string;
    block?: string;
    flatType?: string;
    storeyRange?: string;
    floorAreaSqm?: number;
    flatModel?: string;
    leaseCommenceDate?: number;
    askingPrice?: number;
    status?:
      | 'draft'
      | 'listed'
      | 'offer_received'
      | 'under_option'
      | 'completing'
      | 'completed'
      | 'withdrawn';
  }) {
    return testPrisma.property.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        town: overrides.town ?? 'TAMPINES',
        street: overrides.street ?? 'TAMPINES ST 21',
        block: overrides.block ?? '123',
        flatType: overrides.flatType ?? '4 ROOM',
        storeyRange: overrides.storeyRange ?? '07 TO 09',
        floorAreaSqm: overrides.floorAreaSqm ?? 93,
        flatModel: overrides.flatModel ?? 'Model A',
        leaseCommenceDate: overrides.leaseCommenceDate ?? 1995,
        askingPrice: overrides.askingPrice,
        status: overrides.status ?? 'draft',
      },
    });
  },

  async hdbTransaction(overrides?: {
    month?: string;
    town?: string;
    flatType?: string;
    block?: string;
    streetName?: string;
    storeyRange?: string;
    floorAreaSqm?: number;
    flatModel?: string;
    leaseCommenceDate?: number;
    remainingLease?: string;
    resalePrice?: number;
    source?: 'csv_seed' | 'datagov_sync';
  }) {
    return testPrisma.hdbTransaction.create({
      data: {
        id: createId(),
        month: overrides?.month ?? '2024-01',
        town: overrides?.town ?? 'TAMPINES',
        flatType: overrides?.flatType ?? '4 ROOM',
        block: overrides?.block ?? '456',
        streetName: overrides?.streetName ?? 'TAMPINES ST 21',
        storeyRange: overrides?.storeyRange ?? '07 TO 09',
        floorAreaSqm: overrides?.floorAreaSqm ?? 93,
        flatModel: overrides?.flatModel ?? 'Model A',
        leaseCommenceDate: overrides?.leaseCommenceDate ?? 1995,
        remainingLease: overrides?.remainingLease ?? '68 years 03 months',
        resalePrice: overrides?.resalePrice ?? 500000,
        source: overrides?.source ?? 'csv_seed',
      },
    });
  },

  async consentRecord(overrides: {
    subjectType: 'seller' | 'buyer';
    subjectId: string;
    purposeService?: boolean;
    purposeMarketing?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return testPrisma.consentRecord.create({
      data: {
        id: createId(),
        subjectType: overrides.subjectType,
        subjectId: overrides.subjectId,
        purposeService: overrides.purposeService ?? true,
        purposeMarketing: overrides.purposeMarketing ?? false,
        ipAddress: overrides.ipAddress ?? '127.0.0.1',
        userAgent: overrides.userAgent ?? 'test-agent',
      },
    });
  },

  async agentSetting(overrides: { agentId: string; key: string; value: string }) {
    return testPrisma.agentSetting.create({
      data: {
        id: createId(),
        agentId: overrides.agentId,
        key: overrides.key,
        encryptedValue: encrypt(overrides.value),
      },
    });
  },

  async notification(overrides: {
    recipientType: 'seller' | 'agent';
    recipientId: string;
    channel?: 'whatsapp' | 'email' | 'in_app';
    templateName?: string;
    content?: string;
    status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  }) {
    return testPrisma.notification.create({
      data: {
        id: createId(),
        recipientType: overrides.recipientType,
        recipientId: overrides.recipientId,
        channel: overrides.channel ?? 'in_app',
        templateName: overrides.templateName ?? 'generic',
        content: overrides.content ?? 'Test notification',
        status: overrides.status ?? 'pending',
      },
    });
  },

  async listing(overrides: {
    propertyId: string;
    title?: string;
    description?: string;
    status?: 'draft' | 'pending_review' | 'approved' | 'live' | 'paused' | 'closed';
    photos?: string;
  }) {
    return testPrisma.listing.create({
      data: {
        id: createId(),
        propertyId: overrides.propertyId,
        title: overrides.title ?? null,
        description: overrides.description ?? null,
        status: overrides.status ?? 'draft',
        photos: overrides.photos ?? '[]',
      },
    });
  },

  async portalListing(overrides: {
    listingId: string;
    portalName?: 'propertyguru' | 'ninety_nine_co' | 'srx' | 'other';
    status?: 'ready' | 'posted' | 'expired';
    portalListingUrl?: string;
  }) {
    return testPrisma.portalListing.create({
      data: {
        id: createId(),
        listingId: overrides.listingId,
        portalName: overrides.portalName ?? 'propertyguru',
        portalReadyContent: {},
        status: overrides.status ?? 'ready',
        portalListingUrl: overrides.portalListingUrl ?? null,
      },
    });
  },

  async offer(overrides: {
    propertyId: string;
    buyerName?: string;
    buyerPhone?: string;
    buyerAgentName?: string;
    buyerAgentCeaReg?: string;
    isCoBroke?: boolean;
    offerAmount?: number;
    status?: 'pending' | 'countered' | 'accepted' | 'rejected' | 'expired';
    notes?: string;
    parentOfferId?: string;
    counterAmount?: number;
  }) {
    return testPrisma.offer.create({
      data: {
        id: createId(),
        propertyId: overrides.propertyId,
        buyerName: overrides.buyerName ?? 'Test Buyer',
        buyerPhone: overrides.buyerPhone ?? '91234567',
        buyerAgentName: overrides.buyerAgentName ?? null,
        buyerAgentCeaReg: overrides.buyerAgentCeaReg ?? null,
        isCoBroke: overrides.isCoBroke ?? false,
        offerAmount: overrides.offerAmount ?? 600000,
        status: overrides.status ?? 'pending',
        notes: overrides.notes ?? null,
        parentOfferId: overrides.parentOfferId ?? null,
        counterAmount: overrides.counterAmount ?? null,
      },
    });
  },

  async videoTutorial(overrides?: {
    title?: string;
    slug?: string;
    description?: string;
    youtubeUrl?: string;
    category?: 'photography' | 'forms' | 'process' | 'financial';
    orderIndex?: number;
  }) {
    return testPrisma.videoTutorial.create({
      data: {
        id: createId(),
        title: overrides?.title ?? 'Test Tutorial',
        slug: overrides?.slug ?? `test-tutorial-${createId()}`,
        description: overrides?.description ?? 'A test video tutorial',
        youtubeUrl: overrides?.youtubeUrl ?? 'https://www.youtube.com/watch?v=test',
        category: overrides?.category ?? 'process',
        orderIndex: overrides?.orderIndex ?? 0,
      },
    });
  },

  async financialReport(overrides: {
    sellerId: string;
    propertyId: string;
    reportData?: Record<string, unknown>;
    aiNarrative?: string;
    aiProvider?: string;
    aiModel?: string;
    version?: number;
    status?: 'draft' | 'ai_generated' | 'pending_review' | 'approved' | 'rejected' | 'sent';
    reviewedByAgentId?: string;
    approvedAt?: Date;
    sentToSellerAt?: Date;
    sentVia?: string;
  }) {
    return testPrisma.financialReport.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        propertyId: overrides.propertyId,
        reportData: (overrides.reportData || {
          inputs: { salePrice: 500000, outstandingLoan: 200000 },
          outputs: { netCashProceeds: 127857 },
          metadata: {
            flatType: '4 ROOM',
            town: 'TAMPINES',
            leaseCommenceDate: 1995,
            calculatedAt: new Date().toISOString(),
          },
        }) as Prisma.InputJsonValue,
        aiNarrative: overrides.aiNarrative,
        aiProvider: overrides.aiProvider,
        aiModel: overrides.aiModel,
        version: overrides.version ?? 1,
        status: overrides.status ?? 'draft',
        reviewedByAgentId: overrides.reviewedByAgentId,
        approvedAt: overrides.approvedAt,
        sentToSellerAt: overrides.sentToSellerAt,
        sentVia: overrides.sentVia,
      },
    });
  },

  async documentChecklist(overrides: {
    sellerId: string;
    propertyId: string;
    items?: Record<string, unknown>[];
    status?: 'draft' | 'pending_review' | 'approved' | 'rejected';
    reviewedByAgentId?: string;
    reviewedAt?: Date;
    reviewNotes?: string;
    approvedAt?: Date;
  }) {
    return testPrisma.documentChecklist.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        propertyId: overrides.propertyId,
        items: (overrides.items ?? []) as Prisma.InputJsonValue,
        status: overrides.status ?? 'draft',
        reviewedByAgentId: overrides.reviewedByAgentId,
        reviewedAt: overrides.reviewedAt,
        reviewNotes: overrides.reviewNotes,
        approvedAt: overrides.approvedAt,
      },
    });
  },

  async transaction(overrides: {
    sellerId: string;
    propertyId: string;
    agreedPrice?: number;
    status?: 'option_issued' | 'option_exercised' | 'completing' | 'completed' | 'fallen_through';
    completionDate?: Date;
    exerciseDeadline?: Date;
    offerId?: string;
    hdbApplicationStatus?:
      | 'not_started'
      | 'application_submitted'
      | 'approval_in_principle'
      | 'approval_granted'
      | 'resale_checklist_submitted'
      | 'hdb_appointment_booked'
      | 'completed';
  }) {
    return testPrisma.transaction.create({
      data: {
        id: createId(),
        seller: { connect: { id: overrides.sellerId } },
        property: { connect: { id: overrides.propertyId } },
        agreedPrice: overrides.agreedPrice ?? 500000,
        status: overrides.status ?? 'option_issued',
        completionDate: overrides.completionDate ?? null,
        exerciseDeadline: overrides.exerciseDeadline ?? null,
        ...(overrides.offerId ? { offer: { connect: { id: overrides.offerId } } } : {}),
        hdbApplicationStatus: overrides.hdbApplicationStatus ?? null,
      },
    });
  },

  async testimonial(overrides: {
    sellerId: string;
    transactionId: string;
    status?: 'pending_submission' | 'pending_review' | 'approved' | 'rejected';
    content?: string | null;
    rating?: number | null;
    sellerName?: string;
    sellerTown?: string;
    submissionToken?: string;
    tokenExpiresAt?: Date;
    displayOnWebsite?: boolean;
    approvedByAgentId?: string;
  }) {
    return testPrisma.testimonial.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        transactionId: overrides.transactionId,
        status: overrides.status ?? 'pending_submission',
        content: overrides.content ?? null,
        rating: overrides.rating ?? null,
        sellerName: overrides.sellerName ?? 'John T.',
        sellerTown: overrides.sellerTown ?? 'Tampines',
        submissionToken: overrides.submissionToken ?? createId(),
        tokenExpiresAt: overrides.tokenExpiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        displayOnWebsite: overrides.displayOnWebsite ?? false,
        approvedByAgentId: overrides.approvedByAgentId,
      },
    });
  },

  async referral(overrides: {
    referrerSellerId: string;
    referralCode?: string;
    status?: 'link_generated' | 'clicked' | 'lead_created' | 'transaction_completed';
    clickCount?: number;
    referredSellerId?: string;
  }) {
    return testPrisma.referral.create({
      data: {
        id: createId(),
        referrerSellerId: overrides.referrerSellerId,
        referralCode: overrides.referralCode ?? `ref-${createId().slice(0, 8)}`,
        status: overrides.status ?? 'link_generated',
        clickCount: overrides.clickCount ?? 0,
        referredSellerId: overrides.referredSellerId,
      },
    });
  },

  async marketContent(overrides?: {
    town?: string;
    flatType?: string;
    period?: string;
    status?: 'ai_generated' | 'pending_review' | 'approved' | 'rejected' | 'published';
    aiNarrative?: string;
    tiktokFormat?: string;
    instagramFormat?: string;
    linkedinFormat?: string;
    approvedByAgentId?: string;
  }) {
    return testPrisma.marketContent.create({
      data: {
        id: createId(),
        town: overrides?.town ?? 'ALL',
        flatType: overrides?.flatType ?? 'ALL',
        period: overrides?.period ?? `2026-W${Math.floor(Math.random() * 52) + 1}`,
        rawData: { topTowns: [], millionDollar: { count: 0 }, trends: {} },
        status: overrides?.status ?? 'ai_generated',
        aiNarrative: overrides?.aiNarrative,
        tiktokFormat: overrides?.tiktokFormat,
        instagramFormat: overrides?.instagramFormat,
        linkedinFormat: overrides?.linkedinFormat,
        approvedByAgentId: overrides?.approvedByAgentId,
      },
    });
  },

  async estateAgencyAgreement(overrides: {
    sellerId: string;
    agentId: string;
    status?: 'draft' | 'sent_to_seller' | 'signed' | 'active' | 'terminated' | 'expired';
    signedAt?: Date;
    signedCopyPath?: string;
    expiryDate?: Date;
  }) {
    return testPrisma.estateAgencyAgreement.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        agentId: overrides.agentId,
        status: overrides.status ?? 'draft',
        signedAt: overrides.signedAt,
        signedCopyPath: overrides.signedCopyPath,
        expiryDate: overrides.expiryDate,
      },
    });
  },

  async otp(overrides: {
    transactionId: string;
    hdbSerialNumber?: string;
    status?:
      | 'prepared'
      | 'sent_to_seller'
      | 'signed_by_seller'
      | 'returned'
      | 'issued_to_buyer'
      | 'exercised'
      | 'expired';
    issuedAt?: Date;
    agentReviewedAt?: Date | null;
    scannedCopyPathSeller?: string;
    scannedCopyPathReturned?: string;
  }) {
    return testPrisma.otp.create({
      data: {
        id: createId(),
        transactionId: overrides.transactionId,
        hdbSerialNumber: overrides.hdbSerialNumber ?? 'SN-001',
        status: overrides.status ?? 'prepared',
        issuedAt: overrides.issuedAt ?? null,
        agentReviewedAt: overrides.agentReviewedAt ?? null,
        scannedCopyPathSeller: overrides.scannedCopyPathSeller ?? null,
        scannedCopyPathReturned: overrides.scannedCopyPathReturned ?? null,
      },
    });
  },

  async cddRecord(overrides: {
    subjectType: 'seller' | 'counterparty' | 'buyer';
    subjectId: string;
    verifiedByAgentId: string;
    fullName?: string;
    nricLast4?: string;
    identityVerified?: boolean;
    verifiedAt?: Date | null;
    retentionExpiresAt?: Date | null;
  }) {
    return testPrisma.cddRecord.create({
      data: {
        id: createId(),
        subjectType: overrides.subjectType,
        subjectId: overrides.subjectId,
        fullName: overrides.fullName ?? 'Test Person',
        nricLast4: overrides.nricLast4 ?? '567A',
        identityVerified: overrides.identityVerified ?? true,
        verifiedByAgentId: overrides.verifiedByAgentId,
        verifiedAt: overrides.verifiedAt ?? new Date(),
        retentionExpiresAt: overrides.retentionExpiresAt ?? null,
      },
    });
  },

  async caseFlag(overrides: {
    sellerId: string;
    flagType?: import('@prisma/client').CaseFlagType;
    description?: string;
    status?: import('@prisma/client').CaseFlagStatus;
    guidanceProvided?: string | null;
    resolvedAt?: Date | null;
  }) {
    return testPrisma.caseFlag.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        flagType: overrides.flagType ?? 'other',
        description: overrides.description ?? 'Test case flag',
        status: overrides.status ?? 'identified',
        guidanceProvided: overrides.guidanceProvided ?? null,
        resolvedAt: overrides.resolvedAt ?? null,
      },
    });
  },

  async commissionInvoice(overrides: {
    transactionId: string;
    status?: 'pending_upload' | 'uploaded' | 'sent_to_client' | 'paid';
    invoiceFilePath?: string;
    invoiceNumber?: string;
    amount?: number;
    gstAmount?: number;
    totalAmount?: number;
  }) {
    return testPrisma.commissionInvoice.create({
      data: {
        id: createId(),
        transactionId: overrides.transactionId,
        status: overrides.status ?? 'pending_upload',
        invoiceFilePath: overrides.invoiceFilePath ?? null,
        invoiceNumber: overrides.invoiceNumber ?? null,
        amount: overrides.amount ?? 1499,
        gstAmount: overrides.gstAmount ?? 134.91,
        totalAmount: overrides.totalAmount ?? 1633.91,
      },
    });
  },
};

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
    status?: 'draft' | 'ai_generated' | 'pending_review' | 'approved' | 'rejected' | 'sent';
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
};

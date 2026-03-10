import { Prisma } from '@prisma/client';
import { testPrisma } from '../helpers/prisma';
import { createId } from '@paralleldrive/cuid2';

export const factory = {
  async systemSetting(overrides: {
    key: string;
    value: string;
    description?: string;
  }) {
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
    agentId?: string;
    status?: 'lead' | 'engaged' | 'active' | 'completed' | 'archived';
    consentService?: boolean;
    consentMarketing?: boolean;
    leadSource?: 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';
  }) {
    const id = createId();
    return testPrisma.seller.create({
      data: {
        id,
        name: overrides?.name ?? 'Test Seller',
        email: overrides?.email ?? `seller-${id}@test.local`,
        phone: overrides?.phone ?? `8${id.slice(0, 7)}`,
        agentId: overrides?.agentId,
        status: overrides?.status ?? 'lead',
        consentService: overrides?.consentService ?? true,
        consentMarketing: overrides?.consentMarketing ?? false,
        leadSource: overrides?.leadSource ?? 'website',
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
    status?: 'draft' | 'listed' | 'offer_received' | 'under_option' | 'completing' | 'completed' | 'withdrawn';
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
};

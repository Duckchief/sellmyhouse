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
};

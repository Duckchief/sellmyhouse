export type AuditActorType = 'seller' | 'agent' | 'admin' | 'system';

export interface AuditEntry {
  agentId?: string;
  actorType?: AuditActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogRecord {
  id: string;
  agentId: string | null;
  actorType: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

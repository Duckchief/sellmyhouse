export interface AuditEntry {
  agentId?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogRecord {
  id: string;
  agentId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

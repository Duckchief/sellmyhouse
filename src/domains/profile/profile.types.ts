// src/domains/profile/profile.types.ts
import type { AgentRole } from '@prisma/client';

export interface ProfileView {
  id: string;
  name: string;
  email: string;
  role: AgentRole;
  createdAt: Date;
  twoFactorEnabled: boolean;
  avatarPath: string | null;
}

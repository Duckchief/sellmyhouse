// src/domains/profile/profile.service.ts
import path from 'path';
import fs from 'fs/promises';
import bcrypt from 'bcrypt';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import * as repo from './profile.repository';
import * as authRepo from '../auth/auth.repository';
import * as auditService from '../shared/audit.service';
import { scanBuffer } from '@/infra/security/virus-scanner';
import { NotFoundError, ValidationError } from '../shared/errors';
import type { ProfileView } from './profile.types';

const AVATAR_DIR = path.resolve(__dirname, '../../..', 'uploads/avatars');
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/jpg']);

export async function getProfile(agentId: string): Promise<ProfileView> {
  const agent = await repo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);
  return agent as ProfileView;
}

export async function uploadAvatar(agentId: string, file: Express.Multer.File): Promise<void> {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new ValidationError('Only JPEG and PNG images are allowed');
  }
  if (file.size > MAX_SIZE) {
    throw new ValidationError('File too large. Maximum size is 2MB.');
  }

  // Validate actual file bytes — client-supplied Content-Type is not trusted
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new ValidationError('Invalid file type detected');
  }

  // Virus scan before processing
  const scanResult = await scanBuffer(file.buffer, file.originalname ?? 'avatar');
  if (!scanResult.isClean) {
    await auditService.log({
      action: 'upload.virus_detected',
      entityType: 'Agent',
      entityId: agentId,
      details: { filename: file.originalname, viruses: scanResult.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  await fs.mkdir(AVATAR_DIR, { recursive: true });

  const outputPath = path.join(AVATAR_DIR, `${agentId}.jpg`);
  await sharp(file.buffer)
    .resize(256, 256, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(outputPath);

  await repo.updateAvatarPath(agentId, outputPath);

  await auditService.log({
    action: 'agent.avatar_uploaded',
    entityType: 'Agent',
    entityId: agentId,
    details: {},
  });
}

export async function deleteAvatar(agentId: string): Promise<void> {
  const agent = await repo.findAgentById(agentId);
  if (!agent?.avatarPath) return;

  const resolvedPath = path.resolve(agent.avatarPath);
  const avatarDirResolved = path.resolve(AVATAR_DIR);
  if (!resolvedPath.startsWith(avatarDirResolved + path.sep)) {
    throw new ValidationError('Invalid avatar path');
  }

  try {
    await fs.unlink(resolvedPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // File already gone — still clear the DB record
  }

  await repo.clearAvatarPath(agentId);

  await auditService.log({
    action: 'agent.avatar_deleted',
    entityType: 'Agent',
    entityId: agentId,
    details: {},
  });
}

export async function changePassword(
  agentId: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  currentSessionId?: string,
): Promise<void> {
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match');
  }
  if (newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  if (newPassword.length > 72) {
    throw new ValidationError('Password must be 72 characters or fewer');
  }

  const valid = await repo.verifyPassword(agentId, currentPassword);
  if (!valid) throw new ValidationError('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, 12);
  await repo.updatePasswordHash(agentId, hash);

  await authRepo.invalidateUserSessions(agentId, currentSessionId);

  await auditService.log({
    action: 'agent.password_changed',
    entityType: 'Agent',
    entityId: agentId,
    details: {},
  });
}

/** Lightweight check — used by routers to populate hasAvatar in the header */
export async function getHasAvatar(agentId: string): Promise<boolean> {
  const agent = await repo.findAgentById(agentId);
  return !!agent?.avatarPath;
}

// src/domains/profile/profile.service.ts
import path from 'path';
import fs from 'fs/promises';
import bcrypt from 'bcrypt';
import sharp from 'sharp';
import * as repo from './profile.repository';
import { NotFoundError, ValidationError } from '../shared/errors';
import type { ProfileView } from './profile.types';

const AVATAR_DIR = path.resolve('uploads/avatars');
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

  await fs.mkdir(AVATAR_DIR, { recursive: true });

  const outputPath = path.join(AVATAR_DIR, `${agentId}.jpg`);
  await sharp(file.buffer)
    .resize(256, 256, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(outputPath);

  await repo.updateAvatarPath(agentId, outputPath);
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
}

export async function changePassword(
  agentId: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match');
  }
  if (newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const valid = await repo.verifyPassword(agentId, currentPassword);
  if (!valid) throw new ValidationError('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, 12);
  await repo.updatePasswordHash(agentId, hash);
}

/** Lightweight check — used by routers to populate hasAvatar in the header */
export async function getHasAvatar(agentId: string): Promise<boolean> {
  const agent = await repo.findAgentById(agentId);
  return !!agent?.avatarPath;
}

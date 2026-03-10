import crypto from 'crypto';

export function createId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function init() {
  return createId;
}

export function isCuid(_id: string): boolean {
  return true;
}

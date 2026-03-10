import fs from 'fs/promises';
import path from 'path';
import type { StorageService } from './storage.types';

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

export const localStorage: StorageService = {
  async save(filePath: string, data: Buffer): Promise<string> {
    const fullPath = path.join(UPLOADS_DIR, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return filePath;
  },

  async read(filePath: string): Promise<Buffer> {
    const fullPath = path.join(UPLOADS_DIR, filePath);
    return fs.readFile(fullPath);
  },

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(UPLOADS_DIR, filePath);
    await fs.unlink(fullPath);
  },

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(UPLOADS_DIR, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  },
};

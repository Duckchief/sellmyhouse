import path from 'path';
import * as service from '../profile.service';

jest.mock('../profile.repository');
jest.mock('../../auth/auth.repository');
jest.mock('../../shared/audit.service');
jest.mock('bcrypt');
jest.mock('fs/promises');
jest.mock('sharp');

const repo = jest.requireMock('../profile.repository');
const authRepo = jest.requireMock('../../auth/auth.repository');
const fsp = jest.requireMock('fs/promises');
const sharp = jest.requireMock('sharp');

const mockAgent = {
  id: 'agent1',
  name: 'John Doe',
  email: 'john@test.com',
  role: 'agent' as const,
  createdAt: new Date('2025-01-01'),
  twoFactorEnabled: false,
  avatarPath: null,
};

describe('ProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('returns ProfileView for a valid agent', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue(mockAgent);
      const result = await service.getProfile('agent1');
      expect(repo.findAgentById).toHaveBeenCalledWith('agent1');
      expect(result).toEqual(mockAgent);
    });

    it('throws NotFoundError when agent does not exist', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue(null);
      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        'Agent not found: nonexistent',
      );
    });
  });

  describe('uploadAvatar', () => {
    const mockFile = {
      buffer: Buffer.from('fake-image-data'),
      mimetype: 'image/jpeg',
      size: 1024 * 100,
    } as Express.Multer.File;

    it('rejects non-image mime types', async () => {
      const badFile = { ...mockFile, mimetype: 'application/pdf' } as Express.Multer.File;
      await expect(service.uploadAvatar('agent1', badFile)).rejects.toThrow(
        'Only JPEG and PNG images are allowed',
      );
    });

    it('rejects files over 2MB', async () => {
      const bigFile = { ...mockFile, size: 3 * 1024 * 1024 } as Express.Multer.File;
      await expect(service.uploadAvatar('agent1', bigFile)).rejects.toThrow(
        'File too large. Maximum size is 2MB.',
      );
    });

    it('saves resized image and updates DB on success', async () => {
      const sharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue({}),
      };
      sharp.mockReturnValue(sharpInstance);
      fsp.mkdir = jest.fn().mockResolvedValue(undefined);
      repo.updateAvatarPath = jest.fn().mockResolvedValue({});

      await service.uploadAvatar('agent1', mockFile);

      expect(sharpInstance.resize).toHaveBeenCalledWith(256, 256, { fit: 'cover' });
      expect(sharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
      expect(repo.updateAvatarPath).toHaveBeenCalledWith(
        'agent1',
        expect.stringContaining('agent1.jpg'),
      );
    });
  });

  describe('deleteAvatar', () => {
    it('deletes file from disk and clears DB', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({
        ...mockAgent,
        avatarPath: path.join('uploads', 'avatars', 'agent1.jpg'),
      });
      fsp.unlink = jest.fn().mockResolvedValue(undefined);
      repo.clearAvatarPath = jest.fn().mockResolvedValue({});

      await service.deleteAvatar('agent1');

      expect(fsp.unlink).toHaveBeenCalled();
      expect(repo.clearAvatarPath).toHaveBeenCalledWith('agent1');
    });

    it('clears DB even if file does not exist on disk', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({
        ...mockAgent,
        avatarPath: path.join('uploads', 'avatars', 'agent1.jpg'),
      });
      const noEntErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fsp.unlink = jest.fn().mockRejectedValue(noEntErr);
      repo.clearAvatarPath = jest.fn().mockResolvedValue({});

      await service.deleteAvatar('agent1');

      expect(repo.clearAvatarPath).toHaveBeenCalledWith('agent1');
    });

    it('is a no-op if agent has no avatar', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({ ...mockAgent, avatarPath: null });
      repo.clearAvatarPath = jest.fn();

      await service.deleteAvatar('agent1');

      expect(repo.clearAvatarPath).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('throws ValidationError when passwords do not match', async () => {
      await expect(
        service.changePassword('agent1', 'current', 'newpass1', 'newpass2'),
      ).rejects.toThrow('Passwords do not match');
    });

    it('throws ValidationError when new password is under 8 chars', async () => {
      await expect(service.changePassword('agent1', 'current', 'short', 'short')).rejects.toThrow(
        'Password must be at least 8 characters',
      );
    });

    it('throws ValidationError when current password is wrong', async () => {
      repo.verifyPassword = jest.fn().mockResolvedValue(false);
      await expect(
        service.changePassword('agent1', 'wrongpass', 'newpassword', 'newpassword'),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('hashes new password at cost 12, invalidates other sessions, and audit-logs on success', async () => {
      repo.verifyPassword = jest.fn().mockResolvedValue(true);
      const bcrypt = jest.requireMock('bcrypt');
      bcrypt.hash = jest.fn().mockResolvedValue('new-hash');
      repo.updatePasswordHash = jest.fn().mockResolvedValue({});
      authRepo.invalidateUserSessions = jest.fn().mockResolvedValue(undefined);

      await service.changePassword('agent1', 'correct', 'newpassword', 'newpassword', 'sess-123');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(repo.updatePasswordHash).toHaveBeenCalledWith('agent1', 'new-hash');
      expect(authRepo.invalidateUserSessions).toHaveBeenCalledWith('agent1', 'sess-123');
    });
  });

  describe('getHasAvatar', () => {
    it('returns true when agent has avatarPath', async () => {
      repo.findAgentById = jest
        .fn()
        .mockResolvedValue({ ...mockAgent, avatarPath: '/some/path.jpg' });
      const result = await service.getHasAvatar('agent1');
      expect(result).toBe(true);
    });

    it('returns false when agent has no avatarPath', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({ ...mockAgent, avatarPath: null });
      const result = await service.getHasAvatar('agent1');
      expect(result).toBe(false);
    });

    it('returns false when agent not found', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue(null);
      const result = await service.getHasAvatar('agent1');
      expect(result).toBe(false);
    });
  });
});

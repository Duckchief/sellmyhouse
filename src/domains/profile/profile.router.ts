// src/domains/profile/profile.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole, requireTwoFactor } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '../auth/auth.types';
import * as service from './profile.service';
import { avatarUpload } from './profile.multer';

export const profileRouter = Router();

const profileAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /profile — render profile page
profileRouter.get(
  '/profile',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const profile = await service.getProfile(user.id);
      const template =
        user.role === 'admin'
          ? 'pages/profile/index-admin.njk'
          : 'pages/profile/index.njk';

      res.render(template, {
        pageTitle: 'Profile',
        user,
        hasAvatar: !!profile.avatarPath,
        profile,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile/avatar — upload avatar
profileRouter.post(
  '/profile/avatar',
  ...profileAuth,
  avatarUpload.single('avatar'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      await service.uploadAvatar(user.id, req.file);

      // Return HTMX partial — the avatar element with the new image
      return res.render('partials/profile/avatar-display.njk', {
        user,
        hasAvatar: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /profile/avatar — remove avatar
profileRouter.delete(
  '/profile/avatar',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await service.deleteAvatar(user.id);

      // Return HTMX partial — the initials fallback
      return res.render('partials/profile/avatar-display.njk', {
        user,
        hasAvatar: false,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile/password — change password
profileRouter.post(
  '/profile/password',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { currentPassword, newPassword, confirmPassword } = req.body;

      await service.changePassword(user.id, currentPassword, newPassword, confirmPassword);

      if (req.headers['hx-request']) {
        return res.render('partials/profile/password-result.njk', {
          success: true,
          message: 'Password updated successfully',
        });
      }
      res.redirect('/profile');
    } catch (err) {
      next(err);
    }
  },
);

// GET /profile/avatar/:agentId — serve avatar file (auth-checked)
profileRouter.get(
  '/profile/avatar/:agentId',
  requireAuth(),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.params['agentId'] as string;
      // Sanitise: agentId must be alphanumeric/dash only (cuid2 format)
      if (!/^[a-z0-9_-]{10,32}$/i.test(agentId)) {
        return res.status(400).send('Invalid agent ID');
      }

      const avatarPath = path.resolve('uploads/avatars', `${agentId}.jpg`);
      // Ensure resolved path stays within uploads/avatars directory
      const uploadsDir = path.resolve('uploads/avatars');
      if (!avatarPath.startsWith(uploadsDir)) {
        return res.status(400).send('Invalid path');
      }

      if (!fs.existsSync(avatarPath)) {
        return res.status(404).send('Not found');
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(avatarPath);
    } catch (err) {
      next(err);
    }
  },
);

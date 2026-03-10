import { Router, Request, Response, NextFunction } from 'express';
import * as service from './agent-settings.service';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import { requireRole, requireTwoFactor } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AgentSettingKey } from './agent-settings.types';
import { WHATSAPP_KEYS, SMTP_KEYS } from './agent-settings.types';

export const agentSettingsRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

agentSettingsRouter.get(
  '/agent/settings',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const settings = await service.getSettingsView(user.id);

      if (req.headers['hx-request']) {
        return res.render('pages/agent/settings', { settings });
      }
      res.render('pages/agent/settings', { settings });
    } catch (err) {
      next(err);
    }
  },
);

agentSettingsRouter.post(
  '/agent/settings/whatsapp',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      for (const key of WHATSAPP_KEYS) {
        const value = req.body[key];
        if (value && typeof value === 'string' && value.trim()) {
          await service.saveSetting(user.id, key as AgentSettingKey, value.trim());
        }
      }

      if (req.headers['hx-request']) {
        return res.render('partials/agent/settings-result', {
          success: true,
          message: 'WhatsApp settings saved',
        });
      }
      res.redirect('/agent/settings');
    } catch (err) {
      next(err);
    }
  },
);

agentSettingsRouter.post(
  '/agent/settings/email',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      for (const key of SMTP_KEYS) {
        const value = req.body[key];
        if (value && typeof value === 'string' && value.trim()) {
          await service.saveSetting(user.id, key as AgentSettingKey, value.trim());
        }
      }

      if (req.headers['hx-request']) {
        return res.render('partials/agent/settings-result', {
          success: true,
          message: 'Email settings saved',
        });
      }
      res.redirect('/agent/settings');
    } catch (err) {
      next(err);
    }
  },
);

agentSettingsRouter.post(
  '/agent/settings/test/whatsapp',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await service.testWhatsAppConnection(user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/settings-result', result);
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

agentSettingsRouter.post(
  '/agent/settings/test/email',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await service.testSmtpConnection(user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/settings-result', result);
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

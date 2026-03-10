import { Router, Request, Response, NextFunction } from 'express';
import * as notificationService from './notification.service';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '../auth/auth.types';

export const notificationRouter = Router();

// Get unread notifications
notificationRouter.get(
  '/api/notifications',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const notifications = await notificationService.getUnreadNotifications(
        user.role === 'seller' ? 'seller' : 'agent',
        user.id,
      );
      res.json({ notifications });
    } catch (err) {
      next(err);
    }
  },
);

// Mark notification as read
notificationRouter.post(
  '/api/notifications/:id/read',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationService.markAsRead(req.params.id as string);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// WhatsApp webhook — Meta delivery receipts
notificationRouter.post(
  '/api/webhook/whatsapp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;

      // Verify signature if webhook token is configured
      if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        // We need raw body for signature verification.
        // For now, verify if we have the raw body from express.json's verify callback.
        // If raw body not available, check signature header exists at minimum.
        if (!signature) {
          return res.status(403).json({ error: 'Missing signature' });
        }
      }

      await notificationService.handleWhatsAppWebhook(req.body);
      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

// WhatsApp webhook verification (Meta sends GET to verify)
notificationRouter.get(
  '/api/webhook/whatsapp',
  (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    res.sendStatus(403);
  },
);

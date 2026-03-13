import { Router, Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import * as notificationService from './notification.service';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '../auth/auth.types';
import { markAsReadRules, webhookPayloadRules } from './notification.validator';

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
  markAsReadRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
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
  webhookPayloadRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = req.rawBody;

      // Signature verification is unconditional — WHATSAPP_WEBHOOK_VERIFY_TOKEN
      // is required at startup (see validateEnv in app.ts)
      if (!rawBody || !notificationService.verifyWebhookSignature(rawBody, signature)) {
        return res.status(403).json({ error: 'Invalid signature' });
      }

      await notificationService.handleWhatsAppWebhook(req.body);
      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

// Unsubscribe from marketing emails via link in email
notificationRouter.get(
  '/api/notifications/unsubscribe',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).render('pages/error', { message: 'Missing token' });

      const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
        sellerId: string;
        purpose: string;
      };

      if (payload.purpose !== 'marketing_consent_withdrawal') {
        return res.status(400).render('pages/error', { message: 'Invalid token' });
      }

      await notificationService.handleUnsubscribe(payload.sellerId);
      res.render('pages/unsubscribe-confirmed');
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
        return res
          .status(400)
          .render('pages/error', { message: 'Invalid or expired unsubscribe link' });
      }
      next(err);
    }
  },
);

// WhatsApp webhook verification (Meta sends GET to verify)
notificationRouter.get('/api/webhook/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

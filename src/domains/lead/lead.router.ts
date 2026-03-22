import { Router } from 'express';
import { validateLeadInput } from './lead.validator';
import { submitLead } from './lead.service';
import { leadRateLimiter } from '../../infra/http/middleware/rate-limit';
import { ValidationError, ConflictError } from '../shared/errors';
import type { LeadSource } from './lead.types';
import { linkReferralToLead } from '../content/content.service';

export const leadRouter = Router();

const VALID_LEAD_SOURCES = ['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'];

leadRouter.post('/api/leads', leadRateLimiter, async (req, res, next) => {
  try {
    const leadSource = VALID_LEAD_SOURCES.includes(req.body.leadSource)
      ? (req.body.leadSource as LeadSource)
      : 'website';

    const countryCode = req.body.countryCode ?? '+65';
    const nationalNumber = (req.body.nationalNumber ?? req.body.phone ?? '').replace(/\D/g, '');
    const phone = countryCode + nationalNumber;

    const input = {
      name: req.body.name ?? '',
      email: req.body.email ?? '',
      countryCode,
      nationalNumber,
      phone,
      consentService: req.body.consentService === 'true' || req.body.consentService === true,
      consentMarketing: req.body.consentMarketing === 'true' || req.body.consentMarketing === true,
      leadSource,
      honeypot: req.body.website ?? '', // honeypot field named "website"
      formLoadedAt: req.body.formLoadedAt ? parseInt(req.body.formLoadedAt, 10) : undefined,
    };

    const errors = validateLeadInput(input);
    if (errors) {
      if (errors._bot) {
        // Silent rejection for bots — return success to avoid revealing detection
        if (req.headers['hx-request']) {
          return res.render('partials/public/lead-success');
        }
        return res.json({ success: true });
      }
      throw new ValidationError('Invalid input', errors);
    }

    const { sellerId } = await submitLead({
      ...input,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Link referral if the visitor came via a referral link
    if (req.session.referralCode) {
      try {
        await linkReferralToLead(req.session.referralCode, sellerId);
      } catch {
        // ignore — don't fail the lead submission
      }
      delete req.session.referralCode;
    }

    if (req.headers['hx-request']) {
      return res.render('partials/public/lead-success');
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    if (err instanceof ConflictError) {
      if (req.headers['hx-request']) {
        return res.status(200).render('partials/public/lead-already-registered');
      }
      return res.status(200).json({ success: true, alreadyRegistered: true });
    }
    next(err);
  }
});

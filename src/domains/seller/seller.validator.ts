import { param } from 'express-validator';
import { TOTAL_ONBOARDING_STEPS } from './seller.types';

export const validateOnboardingStep = [
  param('step')
    .isInt({ min: 1, max: TOTAL_ONBOARDING_STEPS })
    .withMessage(`Step must be between 1 and ${TOTAL_ONBOARDING_STEPS}`)
    .toInt(),
];

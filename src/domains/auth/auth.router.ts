import { Router } from 'express';
import { registrationRouter } from './auth.registration.router';
import { loginRouter } from './auth.login.router';
import { twoFactorRouter } from './auth.two-factor.router';

export const authRouter = Router();

authRouter.use(registrationRouter);
authRouter.use(loginRouter);
authRouter.use(twoFactorRouter);

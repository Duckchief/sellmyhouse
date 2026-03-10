import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import * as authService from '../../../domains/auth/auth.service';
import type { AuthenticatedUser } from '../../../domains/auth/auth.types';

export function configurePassport() {
  // Seller local strategy
  passport.use(
    'seller-local',
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const seller = await authService.loginSeller(email, password);
          if (!seller) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const user: AuthenticatedUser = {
            id: seller.id,
            role: 'seller',
            email: seller.email!,
            name: seller.name,
            twoFactorEnabled: seller.twoFactorEnabled,
            twoFactorVerified: false,
          };

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  // Agent local strategy
  passport.use(
    'agent-local',
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const agent = await authService.loginAgent(email, password);
          if (!agent) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const user: AuthenticatedUser = {
            id: agent.id,
            role: agent.role === 'admin' ? 'admin' : 'agent',
            email: agent.email,
            name: agent.name,
            twoFactorEnabled: agent.twoFactorEnabled,
            twoFactorVerified: false,
          };

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  // Serialize full AuthenticatedUser as JSON to avoid DB lookup per request
  passport.serializeUser((user, done) => {
    done(null, JSON.stringify(user));
  });

  passport.deserializeUser((data: string, done) => {
    try {
      const user = JSON.parse(data) as AuthenticatedUser;
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  return passport;
}

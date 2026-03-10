import type { AuthenticatedUser } from '../../domains/auth/auth.types';

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}

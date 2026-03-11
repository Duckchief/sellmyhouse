import type { AuthenticatedUser } from '../../domains/auth/auth.types';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}

    interface Request {
      rawBody?: Buffer;
    }
  }
}

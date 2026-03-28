import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgSession = connectPgSimple(session);

export function createSessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }

  return session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: 'session',
    }),
    name: 'smh.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'strict',
    },
  });
}

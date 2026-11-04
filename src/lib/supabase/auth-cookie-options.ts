/** Persist the Supabase session cookie for one year; Auth rotates short-lived JWTs. */
export const AUTH_SESSION_COOKIE_OPTIONS = {
  maxAge: 365 * 24 * 60 * 60,
} as const;

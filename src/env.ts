import { z } from 'zod';

/**
 * Validated environment. Import on the server only; the browser gets the
 * NEXT_PUBLIC_* values through Next's inlining.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  GUESTY_CLIENT_ID: z.string().min(1).optional(),
  GUESTY_CLIENT_SECRET: z.string().min(1).optional(),
  GUESTY_ACCOUNT_ID: z.string().min(1).default('682f39ceca0d576ff1aa1da7'),
  GUESTY_WEBHOOK_SECRET: z.string().min(1).optional(),
  GUESTY_LAUNDRY_FIELD_ID: z.string().min(1).default('6ab385c5bcf98e0011a9419d'),
  GUESTY_CLEANER_FIELD_ID: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  /** Public origin of the deployment (e-mail links, webhook URL); Vercel's production URL is the fallback. */
  APP_URL: z.string().url().optional(),
  APP_ENV: z.enum(['staging', 'production']).default('staging'),
  SEED_MODE: bool,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PRICELABS_API_KEY: z.string().min(1).optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  /** Telegram bot (BotFather) and the chat it writes to; both or neither. */
  ALERT_TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  ALERT_TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  APP_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {}

/** Parses and validates the environment; refuses seed mode in production. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) cleaned[k] = v === '' ? undefined : v;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new EnvError(`Invalid environment: ${names}`);
  }
  const env = parsed.data;
  if (env.SEED_MODE && env.APP_ENV === 'production') throw new EnvError('SEED_MODE is refused when APP_ENV=production');
  // all three Supabase variables or none: a half-configured database would mix the dev sign-in with real sessions
  const supabaseMissing = missingSupabaseEnv(env);
  if (supabaseMissing.length > 0 && supabaseMissing.length < 3) {
    throw new EnvError(`Supabase is only partly configured, missing: ${supabaseMissing.join(', ')}`);
  }
  return env;
}

/** Names of the variables a live Guesty connection needs; empty when all are set. */
export function missingGuestyEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!env.GUESTY_CLIENT_ID) missing.push('GUESTY_CLIENT_ID');
  if (!env.GUESTY_CLIENT_SECRET) missing.push('GUESTY_CLIENT_SECRET');
  return missing;
}

/** Names of the variables the sign-in (browser + proxy) needs; empty when all are set. */
export function missingSupabaseAuthEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

/** Names of the variables the database (sign-in and the service-role sync) needs; empty when all are set. */
export function missingSupabaseEnv(env: Env): string[] {
  const missing = missingSupabaseAuthEnv(env);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

let cached: Env | null = null;
/** Lazily loaded process environment (server only). */
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

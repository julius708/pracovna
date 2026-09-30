import { todayInTz } from '@/core/packing';
import { MemoryRepo } from '@/db/memory-repo';
import type { SyncRepo } from '@/db/repo';
import { createAdminClient, SupabaseRepo } from '@/db/supabase-repo';
import { env as loadEnv, missingGuestyEnv, missingSupabaseEnv, type Env } from '@/env';
import { createGuestyClient, type GuestyClient } from '@/guesty/client';
import { createLogger, type Logger } from '@/guesty/log';
import { createSeedClient } from './seed';

export interface SyncContext {
  env: Env;
  repo: SyncRepo;
  client: GuestyClient;
  log: Logger;
  /** Public URL of the webhook endpoint, when it can be derived. */
  webhookUrl: string | null;
  seed: boolean;
  /** True when the repo is the in-memory one (no Supabase configured). */
  ephemeral: boolean;
}

let memoryRepo: MemoryRepo | null = null;
let liveClient: GuestyClient | null = null;
let seedClient: { today: string; client: GuestyClient } | null = null;

export function webhookUrlFor(env: Env, extra: Record<string, string | undefined> = process.env): string | null {
  const host = extra.APP_URL ?? (extra.VERCEL_PROJECT_PRODUCTION_URL ? `https://${extra.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!host) return null;
  return `${host.replace(/\/$/, '')}/api/guesty/webhook`;
}

/** The database only: Supabase when configured, otherwise (seed mode) a process-wide memory repo. */
export function createRepoFromEnv(env: Env): { repo: SyncRepo; ephemeral: boolean } {
  if (missingSupabaseEnv(env).length === 0) {
    return { repo: new SupabaseRepo(createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)), ephemeral: false };
  }
  if (!env.SEED_MODE) throw new Error(`Missing Supabase configuration: ${missingSupabaseEnv(env).join(', ')}`);
  memoryRepo = memoryRepo ?? new MemoryRepo();
  return { repo: memoryRepo, ephemeral: true };
}

/** Builds repo + Guesty client from the environment: live, or seed mode with the fake client. */
export function createSyncContext(overrides: Partial<SyncContext> = {}): SyncContext {
  const env = overrides.env ?? loadEnv();
  const log = overrides.log ?? createLogger({ level: env.LOG_LEVEL });
  let repo = overrides.repo;
  let ephemeral = false;
  if (!repo) {
    const r = createRepoFromEnv(env);
    repo = r.repo;
    ephemeral = r.ephemeral;
  }
  const repoFinal = repo;
  let client = overrides.client;
  if (!client) {
    if (env.SEED_MODE) {
      const today = todayInTz(new Date());
      if (!seedClient || seedClient.today !== today) seedClient = { today, client: createSeedClient(today).client };
      client = seedClient.client;
    } else {
      const missing = missingGuestyEnv(env);
      if (missing.length) throw new Error(`Missing Guesty configuration: ${missing.join(', ')}`);
      liveClient =
        liveClient ??
        createGuestyClient({
          env,
          tokenStore: repoFinal.tokenStore,
          log,
          onTokenQuotaWarning: (mints) => {
            log.warn('guesty.token.quota_warning', { mints_24h: mints });
            void repoFinal.setState('token_quota_warning', { at: new Date().toISOString(), mints });
          },
        });
      client = liveClient;
    }
  }
  return { env, repo: repoFinal, client, log, webhookUrl: overrides.webhookUrl ?? webhookUrlFor(env), seed: env.SEED_MODE, ephemeral };
}

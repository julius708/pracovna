import type { GuestyHttp } from '../http';
import { extractResults, parseMany, webhookSchema, type ParsedWebhook } from '../schemas';

export async function listWebhooks(http: GuestyHttp): Promise<ParsedWebhook[]> {
  const json = await http.get('/webhooks');
  return parseMany(webhookSchema, extractResults(json));
}

export async function createWebhook(http: GuestyHttp, url: string, events: readonly string[]): Promise<ParsedWebhook> {
  const json = await http.post('/webhooks', { url, events: [...events] });
  return webhookSchema.parse(json);
}

export async function deleteWebhook(http: GuestyHttp, id: string): Promise<void> {
  await http.delete(`/webhooks/${encodeURIComponent(id)}`);
}

export interface WebhookSecretResult {
  /** The Svix signing secret when it could be identified (usually "whsec_…"). */
  secret: string | null;
  /** Keys of the raw response, for the probe log (never the values). */
  responseKeys: string[];
}

/**
 * GET /webhooks-v2/secret?url=… — the response field name is undocumented, so
 * the first string value that looks like a Svix secret is taken.
 */
export async function getWebhookSecret(http: GuestyHttp, url: string): Promise<WebhookSecretResult> {
  const json = await http.get('/webhooks-v2/secret', { url });
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const candidates = Object.values(flatten(o)).filter((v): v is string => typeof v === 'string');
  const secret =
    candidates.find((v) => v.startsWith('whsec_')) ??
    (typeof o.secret === 'string' ? o.secret : null) ??
    (typeof o.signingSecret === 'string' ? o.signingSecret : null) ??
    (typeof o.key === 'string' ? o.key : null);
  return { secret, responseKeys: Object.keys(o) };
}

function flatten(o: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
}

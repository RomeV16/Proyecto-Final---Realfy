import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const toml = readFileSync(join(__dirname, '..', 'wrangler.toml'), 'utf8');
const active = toml
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('CP-1429: wrangler.toml no lleva cuentas, secretos ni inmobiliarias', () => {
  it('tiene el nombre, la API de producción y el slug por defecto vacío', () => {
    expect(active).toMatch(/^name = "realfy-email-worker"$/m);
    expect(active).toMatch(/^API_BASE_URL = "https:\/\/api\.realfy\.app"$/m);
    expect(active).toMatch(/^DEFAULT_TENANT_SLUG = ""$/m);
  });

  it('no define account_id, rutas, secretos ni destino de reenvío', () => {
    expect(active).not.toMatch(/account_id|INBOX_EMAIL_INGEST_SECRET|FALLBACK_FORWARD_TO|\broutes?\b|\[\[kv_namespaces|zone/i);
  });
});

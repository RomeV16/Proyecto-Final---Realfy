# Realfy — Railway runbook

Short operational guide for deploying the API and web services to Railway.

## One-time setup

1. Install + login (user must run — opens browser):
   ```bash
   npm i -g @railway/cli   # if not installed
   railway login
   railway whoami          # confirm
   ```

2. Create / link the project:
   ```bash
   cd /path/to/inmo
   railway init              # first time
   # or: railway link <projectId>
   ```

3. Add managed infra:
   ```bash
   railway add --database postgres
   railway add --database redis
   ```

4. Create two code services (dashboard is simplest):
   - Dashboard → **+ New** → **GitHub Repo** → pick `inmo` (or fork) → name it `api`.
   - Repeat for `web`.
   - For **each code service**, open Settings and set:
     - Root Directory: `/`
     - Config Path: `apps/api/railway.json` (or `apps/web/railway.json`)
     - Branch: `main`

5. Set env vars (CLI):
   ```bash
   railway variables --service api set \
     JWT_SECRET="$(openssl rand -hex 64)" \
     JWT_REFRESH_SECRET="$(openssl rand -hex 64)" \
     NODE_ENV=production \
     DATABASE_URL='${{ Postgres.DATABASE_URL }}' \
     REDIS_URL='${{ Redis.REDIS_URL }}' \
     CORS_ORIGINS=http://localhost:3001

   railway variables --service web set \
     NODE_ENV=production \
     NEXT_PUBLIC_API_URL=http://localhost:3000
   ```

6. Deploy:
   ```bash
   railway up --service api --detach
   railway up --service web --detach
   ```

7. Get real domains and patch the two placeholder URLs:
   ```bash
   railway domain --service api
   railway domain --service web
   # update CORS_ORIGINS on api, NEXT_PUBLIC_API_URL on web, then re-up both
   ```

8. Seed demo data (optional):
   ```bash
   railway run --service api pnpm --filter @realfy/api db:seed
   ```

9. Verify:
   ```bash
   curl https://<api-domain>.up.railway.app/health
   # {"status":"ok","db":"connected","timestamp":"..."}
   ```

## Daily ops

```bash
railway logs    --service api --tail 200
railway logs    --service web --tail 200
railway status
railway restart --service api          # redeploy last artifact, no rebuild
railway up      --service api --detach # rebuild + deploy
```

Pushing to `main` auto-deploys both services (if GitHub integration stayed enabled).

## Things NOT to do without asking first
- `railway down` — tears down a service (data on managed DBs persists, code service goes away).
- Dropping the Postgres plugin — wipes the database irreversibly.
- `railway unlink` from within a CI job — breaks the association.

## Pending (not yet on Railway)
- **MinIO / file storage** — local dev uses MinIO; prod needs Railway MinIO template OR swap to Cloudflare R2 / S3.
- **Custom domain** — `railway domain add <yourdomain.com> --service web` when DNS is ready.
- **Staging environment** — duplicate project and point at a `develop` branch when you need one.

## Troubleshooting
See global skill §9 for the full cookbook. First move always: `railway logs --service <svc>`.

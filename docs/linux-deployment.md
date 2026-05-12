# Linux Server Deployment

This project is a Next.js application with server routes under `app/api/*`, Supabase service-role access, and server-side calls to APIMart and MengFactory. Deploy it as a Node.js app, not as a static site.

Target:

- Server IP: `107.173.25.225`
- Domain: `https://www.zlaction.online/`
- Runtime: Ubuntu/Debian, Node.js 22, pnpm, PM2, Nginx, Certbot

## DNS

In the domain provider control panel, configure:

- `www.zlaction.online` `A` record -> `107.173.25.225`
- Remove conflicting `CNAME` records on `www`.
- Remove stale `AAAA` records unless IPv6 is configured on the server.

Wait for DNS propagation before requesting the HTTPS certificate.

## Server Bootstrap

SSH into the server:

```bash
ssh root@107.173.25.225
```

Install system dependencies:

```bash
apt update
apt install -y ca-certificates curl gnupg git nginx ufw snapd
```

Install Node.js 22 and global tools:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

corepack enable
corepack prepare pnpm@10 --activate
npm install -g pm2

node -v
pnpm -v
pm2 -v
```

## App Setup

Clone and build:

```bash
mkdir -p /var/www
git clone https://github.com/panda-three/-storm-ai.git /var/www/storm-ai
cd /var/www/storm-ai
git checkout main

cp .env.example .env.production
openssl rand -hex 32
nano .env.production

pnpm install --frozen-lockfile
pnpm build
```

Required environment variables in `.env.production`:

- `APIMART_API_KEY`
- `APIMART_BASE_URL`
- `MENGFACTORY_API_KEY`
- `MENGFACTORY_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_GENERATED_IMAGES_BUCKET`
- `CRON_SECRET`
- `APIMART_SYNC_BATCH_SIZE`

After copying `.env.example`, remove or empty `APIMART_PROXY_URL` in `.env.production` unless the server has a confirmed production proxy. Do not deploy with `127.0.0.1` or `localhost` as the APIMart proxy; the current code ignores local APIMart proxies when `NODE_ENV=production`.

## Supabase

Prepare Supabase before starting the app:

1. Open the Supabase SQL Editor for the production project.
2. Run the full contents of `supabase-schema.sql` from this repository.
3. Confirm the SQL completed without errors and that the `generation_jobs`, `user_accounts`, `redeem_codes`, `model_pricing`, `credit_packages`, and `site_settings` tables exist.
4. Confirm the required RPC functions exist, especially `create_generation_job_with_billing`, `fail_generation_job_with_refund`, `spend_generation_credits`, `record_free_generation_usage`, `refund_generation_credits`, `redeem_credit_code`, and `save_user_projects`.

Prepare Supabase Storage:

1. Create a bucket named `generated-images`, or use the same bucket name configured by `SUPABASE_GENERATED_IMAGES_BUCKET`.
2. Make generated image objects publicly readable, or configure equivalent Storage policies that allow the public URLs returned by Supabase to load in browsers.
3. Keep `SUPABASE_SERVICE_ROLE_KEY` only in `.env.production`; never expose it in client code or checked-in files.

If production moves to self-hosted Supabase, follow `docs/self-hosted-supabase.md` before changing `.env.production`. Do not point the live app at a new Supabase instance until database import, Storage import, SMTP, backups, and rollback have been verified.

## PM2

Start and persist the app:

```bash
cd /var/www/storm-ai
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

Run the command printed by `pm2 startup`, then verify:

```bash
pm2 status
curl -I http://127.0.0.1:3000
```

Useful PM2 commands:

```bash
pm2 logs storm-ai
pm2 restart storm-ai --update-env
pm2 stop storm-ai
```

If PM2 starts and immediately errors because `pnpm` cannot be found, check the executable path with `which pnpm`. Then either make that path available to the PM2/systemd environment or update `ecosystem.config.cjs` to use the absolute `pnpm` path on the server. Re-run `pm2 restart storm-ai --update-env` after changing runtime environment variables.

## Nginx

Install the project Nginx template:

```bash
cp /var/www/storm-ai/deploy/nginx/storm-ai.conf /etc/nginx/sites-available/storm-ai
ln -s /etc/nginx/sites-available/storm-ai /etc/nginx/sites-enabled/storm-ai
nginx -t
systemctl reload nginx
```

Enable firewall rules:

```bash
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
ufw status
```

Verify HTTP before HTTPS:

```bash
curl -I http://www.zlaction.online
```

## HTTPS

Install and run Certbot:

```bash
snap install --classic certbot
ln -s /snap/bin/certbot /usr/local/bin/certbot

certbot --nginx -d www.zlaction.online --redirect
certbot renew --dry-run
```

Verify HTTPS:

```bash
curl -I https://www.zlaction.online
```

## Cron Sync

The project has protected cron routes for syncing generation jobs. Use the same value configured in `.env.production` as `CRON_SECRET`.
New deployments should call `/api/cron/sync-generation-jobs`; `/api/cron/sync-apimart-tasks` is kept only as a compatibility route.

Edit root crontab:

```bash
crontab -e
```

Add:

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer REPLACE_WITH_CRON_SECRET" https://www.zlaction.online/api/cron/sync-generation-jobs >/dev/null 2>&1
```

Test manually before relying on cron:

```bash
curl -fsS -X POST -H "Authorization: Bearer REPLACE_WITH_CRON_SECRET" https://www.zlaction.online/api/cron/sync-generation-jobs
```

## Updates

For each release:

```bash
cd /var/www/storm-ai
git pull origin main
pnpm install --frozen-lockfile
pnpm check:env
pnpm build
pm2 restart storm-ai --update-env
```

## Troubleshooting

- If `pnpm build` fails, fix that before restarting PM2.
- If the app boots but login, credits, admin pages, or generation history fail, confirm `supabase-schema.sql` has been run against the production Supabase project.
- If generated images upload but do not display, confirm the `SUPABASE_GENERATED_IMAGES_BUCKET` bucket exists and its public URLs are readable.
- If `curl -I http://127.0.0.1:3000` fails, inspect `pm2 logs storm-ai`.
- If PM2 logs show `pnpm: command not found`, confirm `which pnpm` and use an absolute executable path in `ecosystem.config.cjs` if needed.
- If `http://www.zlaction.online` fails but localhost works, inspect `nginx -t`, `/var/log/nginx/error.log`, and firewall rules.
- If HTTPS issuance fails, confirm DNS points to `107.173.25.225` and ports `80`/`443` are open.
- If APIMart, MengFactory, or Supabase calls fail, test outbound connectivity from the server with `curl` and check whether a production-safe proxy is required.

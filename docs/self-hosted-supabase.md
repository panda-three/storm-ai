# Self-hosted Supabase Runbook

This project can move from Supabase Cloud to a self-hosted Supabase stack, but it must be treated as an infrastructure migration. The app depends on Supabase Auth, PostgREST/RPC, RLS, Storage, and `auth.users` triggers, so do not replace it with a plain PostgreSQL connection unless the auth and storage layers are redesigned.

## Target Shape

- Next.js continues to run through PM2 on port `3000`.
- Self-hosted Supabase is exposed through a dedicated HTTPS hostname such as `https://supabase.zlaction.online`.
- PostgreSQL, internal Supabase services, and Supabase Studio are not exposed directly to the public internet.
- `.env.production` points to the self-hosted API URL and keys after validation is complete.

## Required Hardening

1. Generate new production secrets for the self-hosted stack:
   - Postgres password
   - JWT secret
   - anon key
   - service role key
   - dashboard credentials
2. Run the full `supabase-schema.sql` against the self-hosted project.
3. Confirm the schema grants are present at the end of `supabase-schema.sql`:
   - User RPCs are granted only to `authenticated` or `anon` where intended.
   - Service-only RPCs with `p_user_id` are revoked from `public`, `anon`, and `authenticated`, then granted to `service_role`.
4. Create the `generated-images` bucket, or the bucket configured by `SUPABASE_GENERATED_IMAGES_BUCKET`.
5. Allow public reads only for generated image objects that the app must show in the browser.
6. Configure SMTP before accepting real users. Auth email flows are part of production availability.
7. Keep `SUPABASE_SERVICE_ROLE_KEY` only in server-side environment files.
8. Keep `CRON_SECRET` at least 32 characters and call cron routes from localhost where possible.

## Migration Procedure

1. Put the app in a short maintenance window to avoid writes during the final export.
2. Export from Supabase Cloud:
   - `auth.users`
   - all `public` schema data
   - Storage objects from the generated images bucket
3. Import into self-hosted Supabase.
4. Run `supabase-schema.sql` after import so functions, triggers, policies, indexes, and grants match the app.
5. Compare row counts for:
   - `auth.users`
   - `public.user_accounts`
   - `public.credit_packages`
   - `public.redeem_codes`
   - `public.model_pricing`
   - `public.generation_jobs`
   - `public.site_settings`
6. Update `.env.production`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_GENERATED_IMAGES_BUCKET`
7. Run:

   ```bash
   pnpm check:env
   pnpm build
   pm2 restart storm-ai --update-env
   ```

8. Verify login, admin reads and writes, generation billing, task sync, Storage uploads, and public image loading.

## Current Server Instance

The self-hosted Supabase stack has been installed at `/opt/supabase-storm` on this production server. It is currently a side-by-side instance: the live Next.js app should stay on the old Supabase project until DNS, HTTPS, backup, restore, and data migration are verified.

- Supabase API hostname: `https://supabase.zlaction.online`
- Expected DNS target: `107.173.25.225`
- Internal Kong listener: `127.0.0.1:8000`
- Internal Postgres listener: `127.0.0.1:5432`
- Nginx site: `/etc/nginx/sites-available/supabase-storm`
- App schema applied from `supabase-schema.sql`
- Storage bucket created: `generated-images`

Before issuing HTTPS certificates, create a DNS `A` record:

```text
supabase.zlaction.online -> 107.173.25.225
```

If Cloudflare is used, keep the record in DNS-only mode until Certbot has completed, or make sure HTTP-01 validation can reach this server.

After DNS resolves, run:

```bash
certbot --nginx -d supabase.zlaction.online --redirect
nginx -t
systemctl reload nginx
pnpm check:supabase:selfhosted
```

The check script intentionally fails while DNS is missing. Passing this script is a prerequisite for switching `.env.production`.

If the old Supabase project's direct database password is unavailable, the repository migration script can migrate API-visible Auth users and public schema rows, while preserving `auth.users.id` values and forcing migrated users to change temporary passwords:

```bash
pnpm migrate:supabase:public
pnpm migrate:supabase:public -- --apply
pnpm migrate:supabase:storage
pnpm migrate:supabase:storage -- --apply
```

The first command is a dry run. The second command writes to the self-hosted Supabase instance. It exports migration artifacts to `backups/supabase-migration/`, including `temporary-passwords.json` when users are created. Treat that file as a secret and remove it after users have received their reset instructions.

This API-based path cannot preserve existing user passwords because Supabase Admin API does not expose password hashes from the source project. To preserve passwords exactly, use a database-level dump from the source Supabase project instead.

## Backup and Restore

- Run an encrypted daily PostgreSQL backup and copy it off the production server.
- Back up generated Storage objects off the production server.
- Keep enough retention to recover from accidental deletes and bad migrations.
- Test restoring to a temporary database at least monthly.
- Do not consider the migration complete until a restore has been verified with the app.

Create a local backup with:

```bash
pnpm backup:supabase:selfhosted
```

By default this writes to `backups/supabase/`, which is git-ignored. Set `SUPABASE_BACKUP_DIR=/path/to/backup/root` to write elsewhere. Local backups are not enough for production; copy each backup to off-server storage and periodically perform a restore test.

## Rollback

Keep the old Supabase Cloud project untouched during the migration window. If validation fails:

1. Restore the previous Supabase Cloud values in `.env.production`.
2. Run `pnpm check:env`.
3. Restart the app with `pm2 restart storm-ai --update-env`.
4. Keep the self-hosted stack offline for investigation until data divergence is understood.

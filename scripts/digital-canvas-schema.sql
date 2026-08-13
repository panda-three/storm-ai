-- 数字画布（Digital Canvas）持久化表
-- 在自托管 Supabase 的 SQL Editor 中执行一次即可（可重复执行，幂等）。
-- 设计对齐 public.canvas_documents 的归属 + 软删除 + RLS 模式。

create table if not exists public.digital_canvas_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名数字画布',
  graph jsonb not null default '{}'::jsonb,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.digital_canvas_documents add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.digital_canvas_documents add column if not exists title text not null default '未命名数字画布';
alter table public.digital_canvas_documents add column if not exists graph jsonb not null default '{}'::jsonb;
alter table public.digital_canvas_documents add column if not exists thumbnail_url text;
alter table public.digital_canvas_documents add column if not exists created_at timestamptz not null default now();
alter table public.digital_canvas_documents add column if not exists updated_at timestamptz not null default now();
alter table public.digital_canvas_documents add column if not exists deleted_at timestamptz;

create index if not exists digital_canvas_documents_user_updated_idx
  on public.digital_canvas_documents (user_id, updated_at desc)
  where deleted_at is null;
create index if not exists digital_canvas_documents_user_deleted_idx
  on public.digital_canvas_documents (user_id, deleted_at);

alter table public.digital_canvas_documents enable row level security;

drop policy if exists "Users can read own digital canvas documents" on public.digital_canvas_documents;
create policy "Users can read own digital canvas documents"
on public.digital_canvas_documents
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own digital canvas documents" on public.digital_canvas_documents;
create policy "Users can insert own digital canvas documents"
on public.digital_canvas_documents
for insert
to authenticated
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own digital canvas documents" on public.digital_canvas_documents;
create policy "Users can update own digital canvas documents"
on public.digital_canvas_documents
for update
to authenticated
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own digital canvas documents" on public.digital_canvas_documents;
create policy "Users can delete own digital canvas documents"
on public.digital_canvas_documents
for delete
to authenticated
using (auth.uid() = user_id or public.is_admin());

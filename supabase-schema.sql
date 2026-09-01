-- ============================================================
-- 文玩手串收藏馆 - Supabase 建表脚本（修正版 v2）
-- 修复：storage.objects.owner_id 是 text 类型，比较时需 ::text 转换
-- 用法：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- ============================================================

-- 1. 手串表（每个用户的数据按 user_id 隔离）
create table if not exists public.bracelets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default '',
  species text not null default '',
  craft text not null default '',
  arrived_at timestamptz,
  price numeric,
  shop text not null default '',
  gifted boolean not null default false,
  gifted_at timestamptz,
  played boolean not null default false,
  played_note text not null default '',
  note text not null default '',
  photos jsonb not null default '[]',
  screenshots jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 开启行级安全（Row Level Security）：用户只能读写自己的数据
alter table public.bracelets enable row level security;

drop policy if exists "bracelets_select_own" on public.bracelets;
create policy "bracelets_select_own"
  on public.bracelets for select
  using (auth.uid() = user_id);

drop policy if exists "bracelets_insert_own" on public.bracelets;
create policy "bracelets_insert_own"
  on public.bracelets for insert
  with check (auth.uid() = user_id);

drop policy if exists "bracelets_update_own" on public.bracelets;
create policy "bracelets_update_own"
  on public.bracelets for update
  using (auth.uid() = user_id);

drop policy if exists "bracelets_delete_own" on public.bracelets;
create policy "bracelets_delete_own"
  on public.bracelets for delete
  using (auth.uid() = user_id);

-- 3. 图片存储桶（公开读取，按用户路径隔离）
insert into storage.buckets (id, name, public)
values ('bracelet-images', 'bracelet-images', true)
on conflict (id) do nothing;

drop policy if exists "bracelet_images_public_read" on storage.objects;
create policy "bracelet_images_public_read"
  on storage.objects for select
  using (bucket_id = 'bracelet-images');

drop policy if exists "bracelet_images_auth_insert" on storage.objects;
create policy "bracelet_images_auth_insert"
  on storage.objects for insert
  with check (bucket_id = 'bracelet-images' and auth.role() = 'authenticated');

-- 注意：owner_id 是 text 类型，auth.uid() 是 uuid，需显式转换
drop policy if exists "bracelet_images_auth_delete" on storage.objects;
create policy "bracelet_images_auth_delete"
  on storage.objects for delete
  using (bucket_id = 'bracelet-images' and auth.uid()::text = owner_id);

-- 完成！可以在左侧 Table Editor 看到 bracelets 表。
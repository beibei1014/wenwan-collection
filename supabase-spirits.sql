-- ============================================================
-- 精灵跨手机同步（localStorage 为主、云端为辅；换手机/换浏览器登录同一账号即可拉回）
-- 用法：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- 设计：每个用户一行（user_id 主键），data 存放整个精灵 store（jsonb），last-write-wins
-- ============================================================

-- 1. 精灵同步表
create table if not exists public.spirit_store (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. 行级安全：只能读写自己的那一行
alter table public.spirit_store enable row level security;

drop policy if exists "spirit_store_select_own" on public.spirit_store;
create policy "spirit_store_select_own"
  on public.spirit_store for select
  using (auth.uid() = user_id);

drop policy if exists "spirit_store_insert_own" on public.spirit_store;
create policy "spirit_store_insert_own"
  on public.spirit_store for insert
  with check (auth.uid() = user_id);

drop policy if exists "spirit_store_update_own" on public.spirit_store;
create policy "spirit_store_update_own"
  on public.spirit_store for update
  using (auth.uid() = user_id);

-- 完成！在 Table Editor 里能看到 spirit_store 表。

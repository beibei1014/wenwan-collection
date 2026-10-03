-- ============================================================
-- 礼物库存 / 发放记录跨手机同步（gift_store）
-- 用法：Supabase Dashboard → SQL Editor → New query → 粘贴全部 → Run
-- 设计：v165 §三.6 / §五.2 / §七-14。形态**与 spirit_store 完全一致**：
--       每个用户一行（user_id 主键），data 存放 {v, gifts, gifted, at}（jsonb），last-write-wins。
--       ⛔ 本表是**独立新表**，绝不碰 ww_spirits / spirit_store。
-- 合并策略：跨机冲突建议在应用侧 mergeGiftStores() 按 giftKey 取 max（见 js/db.js，v165 §七-15）。
-- ============================================================

-- 1. 礼物同步表
create table if not exists public.gift_store (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. 行级安全：只能读写自己的那一行
alter table public.gift_store enable row level security;

drop policy if exists "gift_store_select_own" on public.gift_store;
create policy "gift_store_select_own"
  on public.gift_store for select
  using (auth.uid() = user_id);

drop policy if exists "gift_store_insert_own" on public.gift_store;
create policy "gift_store_insert_own"
  on public.gift_store for insert
  with check (auth.uid() = user_id);

drop policy if exists "gift_store_update_own" on public.gift_store;
create policy "gift_store_update_own"
  on public.gift_store for update
  using (auth.uid() = user_id);

-- 完成！在 Table Editor 里能看到 gift_store 表。
-- data 形状：{ "v":1, "gifts":{ giftKey: count }, "gifted":{ giftKey: dayKey }, "at": ms }

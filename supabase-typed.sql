-- ============================================================
-- 我的收藏馆 - 新增字段（拼图片数 + 周边类型）
-- 用法：SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 拼图片数（500/1000/1500/2000，默认1000）
alter table public.bracelets add column if not exists piece_count numeric;

-- 动漫周边类型（手办/吧唧/镭射卡/立牌…）
alter table public.bracelets add column if not exists accessory_type text not null default '';

-- 完成！
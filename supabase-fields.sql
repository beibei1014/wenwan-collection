-- ============================================================
-- 文玩手串收藏馆 - 新增字段（珠径 + 分类）
-- 用法：SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 珠径（卡数）：6-22mm，默认 14
alter table public.bracelets add column if not exists bead_size numeric;

-- 分类（如：菩提 / 水晶 / 玉石 / 盲盒 / 吧唧…）
alter table public.bracelets add column if not exists category text not null default '';

-- 完成！
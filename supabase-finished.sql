-- ============================================================
-- 文玩手串收藏馆 - 新增字段（拼图完成时间）
-- 用法：SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 拼图完成时间（仅拼图分类使用，其他分类留空）
alter table public.bracelets add column if not exists finished_at timestamptz;

-- 完成！
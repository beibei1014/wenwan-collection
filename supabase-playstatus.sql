-- ============================================================
-- 我的收藏馆 - 新增字段（盘玩/拼图状态）
-- 用法：SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 状态：待盘玩(idle) / 在盘玩(playing) / 待拼(puzzle_pending) / 已拼(puzzle_done)
alter table public.bracelets add column if not exists play_status text not null default '';

-- 完成！
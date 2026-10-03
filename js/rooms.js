/* ============================================================
 * 房间 / 契合度 / 剧情（v109）
 * ------------------------------------------------------------
 * 玩法：沁灵住进「小房间」→ 同一个房间里的沁灵两两积累「契合度」
 *       （每天同住 +1；两只最近都在盘 → 当天 +2）
 *       契合度跨过门槛就解锁一段剧情，栏目页出提示，点进去才看得到。
 * 数据都存本地（和沁灵数据一样，不依赖 Supabase）：
 *   ww_rooms = { [roomId]: { id, name, emoji, note, createdAt, order } }
 *   ww_bonds = { "idA|idB": { affinity, lastDay, best, stories: [ {level, at, title, text, read} ] } }
 *   成员关系存在沁灵记录里（rec.roomId），一尊沁灵同时只住一间房。
 * ============================================================ */
(function () {
  "use strict";

  const ROOM_KEY = "ww_rooms";
  const BOND_KEY = "ww_bonds";
  const STORY_STEPS = [7, 20, 40, 70, 110];      // 契合度门槛（每跨一个 → 一段剧情）
  const STORY_NAMES = ["初识", "熟悉", "默契", "交心", "知己"];
  const ROOM_EMOJIS = ["🏠", "🛋️", "🪟", "🌸", "🍵", "📚", "🌙", "🪴", "🧺", "🎐", "🕯️", "🐚"];
  const ROOM_PRESETS = [
    { name: "窗边小桌", emoji: "🪟" },
    { name: "茶台角", emoji: "🍵" },
    { name: "软垫窝", emoji: "🛋️" },
    { name: "月光架", emoji: "🌙" },
    { name: "书堆旁", emoji: "📚" },
    { name: "花架", emoji: "🌸" },
  ];

  /* ---------- 小工具 ---------- */
  function uid(p) { return (p || "r") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function todayKey(d) { const x = d || new Date(); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function dayNum(key) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; }
  function daysBetween(fromKey, toKey) {
    const a = dayNum(fromKey), b = dayNum(toKey);
    if (a == null || b == null) return 0;
    return Math.max(0, Math.round(b - a));
  }
  function pairKey(a, b) { return String(a) < String(b) ? a + "|" + b : b + "|" + a; }

  /* ---------- 房间 ---------- */
  function loadRooms() {
    try {
      const o = JSON.parse(localStorage.getItem(ROOM_KEY) || "{}");
      return o && typeof o === "object" && o.rooms ? o : { rooms: {} };
    } catch (e) { return { rooms: {} }; }
  }
  function saveRooms(db) { try { localStorage.setItem(ROOM_KEY, JSON.stringify(db)); } catch (e) { /* 忽略 */ } }
  function listRooms() {
    const db = loadRooms();
    return Object.keys(db.rooms).map((k) => db.rooms[k]).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function getRoom(id) { return loadRooms().rooms[id] || null; }
  function createRoom(name, emoji, note) {
    const db = loadRooms();
    const rooms = Object.keys(db.rooms);
    const id = uid("rm");
    const preset = ROOM_PRESETS[rooms.length % ROOM_PRESETS.length];
    db.rooms[id] = {
      id: id,
      name: String(name || "").trim() || preset.name,
      emoji: emoji || preset.emoji,
      note: note || "",
      createdAt: Date.now(),
      order: rooms.length,
    };
    saveRooms(db);
    return db.rooms[id];
  }
  function updateRoom(id, patch) {
    const db = loadRooms();
    if (!db.rooms[id]) return null;
    Object.assign(db.rooms[id], patch || {});
    saveRooms(db);
    return db.rooms[id];
  }
  function removeRoom(id) {
    const db = loadRooms();
    delete db.rooms[id];
    saveRooms(db);
  }
  // 成员存在沁灵记录里（rec.roomId）；item 需要 {id, roomId}
  function membersOf(roomId, items) {
    return (items || []).filter((it) => it && it.roomId === roomId);
  }
  function roomOf(itemId, items) {
    const it = (items || []).find((x) => x && x.id === itemId);
    return it && it.roomId ? getRoom(it.roomId) : null;
  }
  function roomCounts(items) {
    const m = {};
    (items || []).forEach((it) => { if (it && it.roomId) m[it.roomId] = (m[it.roomId] || 0) + 1; });
    return m;
  }

  /* ---------- 契合度 ---------- */
  function loadBonds() {
    try {
      const o = JSON.parse(localStorage.getItem(BOND_KEY) || "{}");
      return o && typeof o === "object" ? o : {};
    } catch (e) { return {}; }
  }
  function saveBonds(b) { try { localStorage.setItem(BOND_KEY, JSON.stringify(b)); } catch (e) { /* 忽略 */ } }
  function bondOf(a, b) {
    const all = loadBonds();
    return all[pairKey(a, b)] || null;
  }
  function affinityOf(a, b) {
    const bd = bondOf(a, b);
    return bd ? (Number(bd.affinity) || 0) : 0;
  }
  // 门槛信息：当前档位、下一档、还差多少、是否能看到进度
  function levelInfo(aff) {
    const n = Number(aff) || 0;
    let lv = 0;
    while (lv < STORY_STEPS.length && n >= STORY_STEPS[lv]) lv++;
    const next = lv < STORY_STEPS.length ? STORY_STEPS[lv] : null;
    // level=已解锁的剧情段数；名字取"当前关系档"（第 1 段解锁后是「初识」，所以用 lv-1）
    const nameIdx = Math.min(Math.max(lv - 1, 0), STORY_NAMES.length - 1);
    return {
      level: lv,
      levelName: STORY_NAMES[nameIdx],
      next: next,
      need: next == null ? 0 : Math.max(0, next - n),
      pct: next == null ? 100 : Math.min(100, Math.round((n / next) * 100)),
      isMax: next == null,
    };
  }
  // 每天涨契合度：同住一天 +1；两只沁灵最近 3 天内都盘过 → 当天 +2
  function tick(items, opts) {
    const now = Date.now();
    const today = todayKey();
    const recent = (opts && opts.recentMs) || 3 * 86400000;
    const byId = {};
    (items || []).forEach((it) => { if (it && it.id) byId[it.id] = it; });
    const byRoom = {};
    Object.keys(byId).forEach((id) => {
      const r = byId[id].roomId;
      if (!r) return;
      (byRoom[r] = byRoom[r] || []).push(byId[id]);
    });
    const bonds = loadBonds();
    const ready = [];       // 刚刚跨过门槛的（需要写剧情）
    let changed = false;
    Object.keys(byRoom).forEach((roomId) => {
      const mem = byRoom[roomId];
      for (let i = 0; i < mem.length; i++) {
        for (let j = i + 1; j < mem.length; j++) {
          const a = mem[i], b = mem[j];
          const k = pairKey(a.id, b.id);
          const _yesterday = todayKey(new Date(Date.now() - 86400000));
          let bd = bonds[k] || { affinity: 0, lastDay: _yesterday, stories: [] };
          if (!Array.isArray(bd.stories)) bd.stories = [];
          if (!bd.lastDay) bd.lastDay = _yesterday;
          const days = daysBetween(bd.lastDay, today);
          if (days > 0) {
            const bothPlayed = (a.lastPlayedAt || 0) > now - recent && (b.lastPlayedAt || 0) > now - recent;
            bd.affinity = (Number(bd.affinity) || 0) + days * (bothPlayed ? 2 : 1);
            bd.lastDay = today;
            bd.updatedAt = now;
            changed = true;
          }
          const before = bd.stories.length;
          const info = levelInfo(bd.affinity);
          // 跨过门槛 → 记一个"待写"的坑（text 为空表示还没生成）
          while (bd.stories.length < info.level) {
            const lv = bd.stories.length;
            bd.stories.push({ level: lv, at: now, title: "", text: "", read: false, members: [a.id, b.id], roomId: roomId });
            changed = true;
          }
          if (bd.stories.length !== before) ready.push({ key: k, a: a.id, b: b.id, roomId: roomId, level: bd.stories[bd.stories.length - 1].level });
          bonds[k] = bd;
        }
      }
    });
    if (changed) saveBonds(bonds);
    return { changed: changed, ready: ready };
  }
  function storyText(a, b, roomId) {
    const bd = bondOf(a, b);
    const room = getRoom(roomId);
    const list = (bd && bd.stories) || [];
    const need = list.filter((s) => !s.text);
    return { bond: bd, room: room, story: need.length ? need[0] : (list.length ? list[list.length - 1] : null), first: need.length ? need[0] : null };
  }
  // 写入一段剧情正文（app.js 生成完文本后回调）
  function writeStory(a, b, level, title, text) {
    const bonds = loadBonds();
    const k = pairKey(a, b);
    const bd = bonds[k];
    if (!bd) return null;
    let slot = null;
    for (let i = 0; i < bd.stories.length; i++) if (bd.stories[i].level === level && !bd.stories[i].text) { slot = bd.stories[i]; break; }
    if (!slot) { slot = { level: level, at: Date.now(), read: false, members: [a, b] }; bd.stories.push(slot); }
    slot.title = title || ("第 " + (level + 1) + " 段 · " + STORY_NAMES[Math.min(level, STORY_NAMES.length - 1)]);
    slot.text = text || "";
    saveBonds(bonds);
    return slot;
  }
  // v125：给某段剧情存一张 CG（事件插画）
  function setStoryImage(a, b, level, url) {
    const bonds = loadBonds();
    const bd = bonds[pairKey(a, b)];
    if (!bd) return null;
    const slot = (bd.stories || []).filter((s) => s.level === level)[0];
    if (!slot) return null;
    slot.img = url || "";
    saveBonds(bonds);
    return slot;
  }
  // v165-R2：给某段剧情存**画面描述**（「描述先行」的第 ⓪① 步；⛔ 不是图，不烧出图额度）
  function setStoryBrief(a, b, level, text) {
    const bonds = loadBonds();
    const bd = bonds[pairKey(a, b)];
    if (!bd) return null;
    const slot = (bd.stories || []).filter((s) => s.level === level)[0];
    if (!slot) return null;
    slot.brief = String(text || "");
    saveBonds(bonds);
    return slot;
  }
  function markRead(a, b, level) {
    const bonds = loadBonds();
    const bd = bonds[pairKey(a, b)];
    if (!bd) return;
    (bd.stories || []).forEach((s) => { if (s.level === level) s.read = true; });
    saveBonds(bonds);
  }
  // 所有"还没看过的剧情"（有正文但 read=false）
  function unreadStories(items) {
    const byId = {};
    (items || []).forEach((it) => { if (it && it.id) byId[it.id] = it; });
    const bonds = loadBonds();
    const out = [];
    Object.keys(bonds).forEach((k) => {
      const bd = bonds[k];
      (bd.stories || []).forEach((s) => {
        if (s.text && !s.read) out.push({ key: k, pair: k.split("|"), story: s, roomId: s.roomId || (byId[(s.members || [])[0]] || {}).roomId || "" });
      });
    });
    return out.sort((x, y) => (y.story.at || 0) - (x.story.at || 0));
  }
  // 还没写正文的剧情坑（进页面时补写）
  function pendingStories(items) {
    const byId = {};
    (items || []).forEach((it) => { if (it && it.id) byId[it.id] = it; });
    const bonds = loadBonds();
    const out = [];
    Object.keys(bonds).forEach((k) => {
      const bd = bonds[k];
      (bd.stories || []).forEach((s) => {
        if (!s.text) out.push({ key: k, a: k.split("|")[0], b: k.split("|")[1], level: s.level, roomId: s.roomId || "" });
      });
    });
    return out;
  }
  function storiesOfRoom(roomId) {
    const bonds = loadBonds();
    const out = [];
    Object.keys(bonds).forEach((k) => {
      (bonds[k].stories || []).forEach((s) => {
        if (s.roomId === roomId) out.push({ key: k, pair: k.split("|"), story: s });
      });
    });
    return out.sort((a, b) => (a.story.level - b.story.level));
  }
  // 房间整体契合度（成员两两平均，用于房间卡片显示）
  function roomAffinity(roomId, items) {
    const mem = membersOf(roomId, items);
    if (mem.length < 2) return { avg: 0, best: null, pairs: 0 };
    let sum = 0, n = 0, best = null;
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
      const a = affinityOf(mem[i].id, mem[j].id);
      sum += a; n++;
      if (!best || a > best.aff) best = { aff: a, a: mem[i], b: mem[j] };
    }
    return { avg: n ? Math.round(sum / n) : 0, best: best, pairs: n };
  }

  window.Rooms = {
    STORY_STEPS, STORY_NAMES, ROOM_EMOJIS, ROOM_PRESETS,
    todayKey, daysBetween, pairKey, uid,
    loadRooms, saveRooms, listRooms, getRoom, createRoom, updateRoom, removeRoom,
    membersOf, roomOf, roomCounts,
    loadBonds, saveBonds, bondOf, affinityOf, levelInfo, tick, storyText, writeStory, markRead,
    unreadStories, pendingStories, storiesOfRoom, roomAffinity,
    setStoryImage, setStoryBrief,
  };
})();

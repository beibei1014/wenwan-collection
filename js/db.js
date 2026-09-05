/* =========================================================
 * db.js — 数据层：Supabase 云端存储（多账号 + 跨设备同步）
 * 依赖 js/config.js 与 Supabase JS SDK（index.html 引入）
 * ========================================================= */
(function () {
  "use strict";

  /* ---------- Supabase 客户端 ---------- */
  let supabase = null;

  function getSupabase() {
    if (supabase) return supabase;
    const cfg = window.SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey || cfg.url.indexOf("PASTE_") === 0) {
      throw new Error("Supabase 尚未配置，请填写 js/config.js 中的 URL 和 Key");
    }
    supabase = window.supabase.createClient(cfg.url, cfg.anonKey);
    return supabase;
  }

  /* ---------- 字段映射：前端 camelCase ↔ 数据库 snake_case ---------- */
  function toDB(item) {
    return {
      id: item.id || undefined,
      user_id: item.user_id,
      name: item.name || "",
      species: item.species || "",
      craft: item.craft || "",
      arrived_at: item.arrivedAt ? new Date(item.arrivedAt).toISOString() : null,
      price: (item.price == null || item.price === "") ? null : Number(item.price),
      shop: item.shop || "",
      gifted: !!item.gifted,
      gifted_at: item.giftedAt ? new Date(item.giftedAt).toISOString() : null,
      played: !!item.played,
      played_note: item.playedNote || "",
      note: item.note || "",
      bead_size: (item.beadSize == null || item.beadSize === "") ? null : Number(item.beadSize),
      category: item.category || "",
      finished_at: item.finishedAt ? new Date(item.finishedAt).toISOString() : null,
      play_status: item.playStatus || "",
      last_played_at: item.lastPlayedAt ? new Date(item.lastPlayedAt).toISOString() : null,
      play_count: item.playCount != null ? Number(item.playCount) || 0 : 0,
      fav: !!item.fav,
      color: item.color || "",
      piece_count: (item.pieceCount == null || item.pieceCount === "") ? null : Number(item.pieceCount),
      accessory_type: item.accessoryType || "",
      photos: (item.photos || []).map(stripBlob),
      screenshots: (item.screenshots || []).map(stripBlob),
      updated_at: new Date().toISOString(),
    };
  }

  function toFront(row) {
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      species: row.species,
      craft: row.craft,
      arrivedAt: row.arrived_at ? new Date(row.arrived_at).getTime() : null,
      price: row.price,
      shop: row.shop,
      gifted: row.gifted,
      giftedAt: row.gifted_at ? new Date(row.gifted_at).getTime() : null,
      played: row.played,
      playedNote: row.played_note,
      note: row.note,
      beadSize: row.bead_size,
      category: row.category || "",
      finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
      playStatus: row.play_status || "",
      lastPlayedAt: row.last_played_at ? new Date(row.last_played_at).getTime() : null,
      playCount: Number(row.play_count) || 0,
      fav: !!row.fav,
      color: row.color || "",
      pieceCount: row.piece_count,
      accessoryType: row.accessory_type || "",
      photos: row.photos || [],
      screenshots: row.screenshots || [],
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    };
  }

  /* 存库时去掉本地 Blob（图片会先上传到 Storage，这里只存 URL） */
  function stripBlob(p) {
    const { data, _url, ...rest } = p;
    return rest;
  }

  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 认证 ---------- */
  async function getSession() {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  async function signUp(email, password) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = getSupabase();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  }

  // 修改密码（登录状态下更新当前账号密码）
  async function updatePassword(newPassword) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
  }

  /* ---------- 用户档案（显示名） ---------- */
  async function getProfile(userId) {
    const sb = getSupabase();
    const { data, error } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    if (error && error.code !== "PGRST116") {
      // PGRST116 = 无匹配行（表可能未建），静默返回空
      if (error.message && error.message.includes("Could not find the table")) return { display_name: "" };
      throw error;
    }
    return { display_name: data ? (data.display_name || "") : "" };
  }

  async function setDisplayName(userId, name) {
    const sb = getSupabase();
    const display_name = (name || "").trim().slice(0, 20);
    const { data, error } = await sb.from("profiles").upsert(
      { id: userId, display_name, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    if (error) throw error;
    return display_name;
  }

  function onAuthChange(cb) {
    const sb = getSupabase();
    sb.auth.onAuthStateChange((event, session) => cb(event, session));
  }

  /* ---------- CRUD ---------- */
  // 可能尚未在数据库建好的新字段（未执行 SQL 时自动降级）
  const OPTIONAL_FIELDS = ["piece_count", "accessory_type", "play_status", "finished_at", "last_played_at", "play_count", "fav", "color"];

  function isMissingColumnErr(error) {
    return error && error.message && error.message.includes("Could not find the") && error.message.includes("column");
  }
  // 从错误消息中提取缺失的列名（形如 Could not find the 'play_status' column ...）
  function missingColumnName(error) {
    const m = /Could not find the '([^']+)' column/.exec(error.message || "");
    return m ? m[1] : null;
  }

  async function put(item) {
    const sb = getSupabase();
    const user = (await sb.auth.getUser()).data.user;
    if (!user) throw new Error("未登录");
    const record = toDB(item);
    record.user_id = user.id;
    const hasId = !!record.id;
    if (hasId) { delete record.id; delete record.created_at; }
    else { delete record.created_at; }
    try {
      const { data, error } = hasId
        ? await sb.from("bracelets").update(record).eq("id", item.id).select().single()
        : await sb.from("bracelets").insert(record).select().single();
      if (error) {
        if (isMissingColumnErr(error)) {
          // 精确降级：只删除报错缺失的那一列，重试（保留 play_status/fav 等其它字段）
          const missing = missingColumnName(error);
          if (missing && record[missing] !== undefined) {
            delete record[missing];
            const { data: d2, error: e2 } = hasId
              ? await sb.from("bracelets").update(record).eq("id", item.id).select().single()
              : await sb.from("bracelets").insert(record).select().single();
            if (!e2) return toFront(d2);
          }
          // 若无法识别缺失列或重试仍失败，做一次兜底：逐字段剔除重试
          let candidate = { ...record };
          for (let i = 0; i < OPTIONAL_FIELDS.length; i++) {
            candidate = { ...candidate };
            delete candidate[OPTIONAL_FIELDS[i]];
            const { data: d3, error: e3 } = hasId
              ? await sb.from("bracelets").update(candidate).eq("id", item.id).select().single()
              : await sb.from("bracelets").insert(candidate).select().single();
            if (!e3) return toFront(d3);
          }
          throw error;
        }
        throw error;
      }
      return toFront(data);
    } catch (err) { throw err; }
  }

  async function getAll() {
    const sb = getSupabase();
    const uid0 = sb.auth.getUser();
    const user = (await uid0).data.user;
    if (!user) throw new Error("未登录");
    const { data, error } = await sb
      .from("bracelets")
      .select("*")
      .eq("user_id", user.id)
      .order("arrived_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data || []).map(toFront);
  }

  async function getById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("bracelets").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return toFront(data);
  }



  async function remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from("bracelets").delete().eq("id", id);
    if (error) throw error;
  }

  /* ---------- 图片上传到 Supabase Storage ---------- */
  async function uploadPhoto(file, pathPrefix) {
    const sb = getSupabase();
    const user = (await sb.auth.getUser()).data.user;
    if (!user) throw new Error("未登录");
    const ext = (file.name || "photo").split(".").pop().toLowerCase() || "jpg";
    const path = (pathPrefix || user.id) + "/" + uid() + "." + ext;
    const { error } = await sb.storage.from("bracelet-images").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    const { data: pub } = sb.storage.from("bracelet-images").getPublicUrl(path);
    return { id: uid(), name: file.name || "photo", type: file.type || "image/jpeg", url: pub.publicUrl, path };
  }

  /* ---------- 删除云端图片 ---------- */
  async function deletePhoto(filePath) {
    const sb = getSupabase();
    const user = (await sb.auth.getUser()).data.user;
    if (!user || !filePath) return;
    const { error } = await sb.storage.from("bracelet-images").remove([filePath]);
    if (error) { /* 忽略删除错误（如文件不存在） */ }
  }

  /* ---------- 备份导出/导入 ---------- */
  async function exportBackup() {
    const items = await getAll();
    return JSON.stringify({
      app: "wenwan-collection",
      version: 2,
      exportedAt: new Date().toISOString(),
      count: items.length,
      items,
    }, null, 2);
  }

  async function importBackup(json) {
    const data = JSON.parse(json);
    if (!data || data.app !== "wenwan-collection" || !Array.isArray(data.items)) {
      throw new Error("不是有效的备份文件");
    }
    const sb = getSupabase();
    const user = (await sb.auth.getUser()).data.user;
    if (!user) throw new Error("未登录");
    // 覆盖语义：先清空当前账号全部记录，再导入
    const { error: delErr } = await sb.from("bracelets").delete().eq("user_id", user.id);
    if (delErr) throw delErr;
    let n = 0;
    for (const it of data.items) {
      const item = {
        ...it,
        arrivedAt: it.arrivedAt || (it.arrived_at ? new Date(it.arrived_at).getTime() : null),
        giftedAt: it.giftedAt || (it.gifted_at ? new Date(it.gifted_at).getTime() : null),
      };
      delete item.id; // 导入时创建新记录
      await put(item);
      n++;
    }
    return n;
  }

  /* ---------- 工具 ---------- */
  function fileToPhoto(file) {
    return { id: uid(), name: file.name || "photo", type: file.type || "image/jpeg", data: file, url: null };
  }

  function daysWith(item, now) {
    now = now || Date.now();
    const end = item.giftedAt || now;
    const start = item.arrivedAt || item.createdAt || now;
    // 按自然日计算（昨天入库 → 1 天，今天入库 → 0 天），而不是滚动 24 小时
    const s = new Date(start), e = new Date(end);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((e - s) / 86400000));
  }

  function formatDays(n) {
    if (n < 1) return "今天刚到";
    if (n < 30) return n + " 天";
    if (n < 365) {
      const m = Math.floor(n / 30);
      return m + " 个月" + (n % 30 ? " " + (n % 30) + " 天" : "");
    }
    const y = Math.floor(n / 365);
    const d = n % 365;
    return y + " 年" + (d ? " " + Math.floor(d / 30) + " 个月" : "");
  }

  window.DB = {
    getSupabase,
    getSession, signUp, signIn, signOut, updatePassword, onAuthChange,
    getProfile, setDisplayName,
    getAll, getById, put, remove,
    uploadPhoto, deletePhoto,
    exportBackup, importBackup,
    fileToPhoto, daysWith, formatDays, uid,
  };
})();
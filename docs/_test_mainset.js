/* v163 需求B 自测：mainSetOf（有效主串集合）+ setMainStory
   覆盖 §C.2 的关键规则：
     1. 5 星自动纳入（>=5 不是 ===5）
     2. 手动集合（不限数量）
     3. 幽灵 id 剔除（已删除的串不再进集合）
     4. 兜底：集合为空 → 开沁最早那只
     5. 移出后保留（取消勾选，集合不再含它）
     6. 已送人的 5 星串不纳入
     7. mainStar5 未写（默认开）
     8. setMainStory 写盘 + switched 累加 + 不双写 mainId
   用法：node docs/_test_mainset.js
*/
"use strict";
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const S = h.sandbox.Spirits;
const store = {};   // 空 rec store（bornAt 不存在 → 兜底走 createdAt）

function mkItems(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ id: "it" + i, name: "串" + i, star: 0, gifted: false, createdAt: Date.now() - (n - i) * 1000 });
  }
  return items;
}
function setStory(o) { h.store.setItem("ww_story", JSON.stringify(o || {})); }

section("A. 5 星自动纳入（>=5，非 ===5）");
{
  const items = mkItems(5);
  items[2].star = 5;
  items[4].star = 6;                 // 6 星也应纳入（>=5）
  setStory({ mainIds: [], mainStar5: true });
  const set = S.mainSetOf(items, store);
  ok(set.has("it2") && set.has("it4"), "5 星与 6 星都自动纳入");
  ok(set.size === 2, "只有 2 只 5 星+ 串（it2,it4）");
}

section("B. 手动集合（不限数量）");
{
  const items = mkItems(6);
  setStory({ mainIds: ["it1", "it3", "it5"], mainStar5: false });
  const set = S.mainSetOf(items, store);
  ok(set.has("it1") && set.has("it3") && set.has("it5"), "手动集合包含 it1,it3,it5");
  ok(!set.has("it0") && !set.has("it2"), "未勾选的不含");
  ok(set.size === 3, "手动共 3 只");
}

section("C. 幽灵 id 剔除");
{
  const items = mkItems(3);          // 只有 it0,it1,it2
  setStory({ mainIds: ["it1", "ghostX", "it9"], mainStar5: false });
  const set = S.mainSetOf(items, store);
  ok(set.has("it1") && !set.has("ghostX") && !set.has("it9"), "已删除的幽灵 id 被剔除");
  ok(set.size === 1, "只剩 it1");
}

section("D. 兜底：集合为空 → 开沁最早那只");
{
  const items = mkItems(4);          // createdAt：it0 最早
  setStory({ mainIds: [], mainStar5: false });   // 无勾选、无 5 星、自动关 → 兜底
  const set = S.mainSetOf(items, store);
  ok(set.has("it0") && set.size === 1, "兜底取开沁最早 it0");
}

section("E. 移出后保留（取消勾选，集合不再含它）");
{
  const items = mkItems(3);
  setStory({ mainIds: ["it0", "it1"], mainStar5: false });
  let set = S.mainSetOf(items, store);
  ok(set.has("it0") && set.has("it1"), "初始含 it0,it1");
  S.setMainStory(["it0"], false);    // 改成只勾 it0
  set = S.mainSetOf(items, store);
  ok(set.has("it0") && !set.has("it1"), "移出 it1（集合不再含）");
}

section("F. 已送人的 5 星串不纳入");
{
  const items = mkItems(3);
  items[1].star = 5; items[1].gifted = true;
  setStory({ mainIds: [], mainStar5: true });
  const set = S.mainSetOf(items, store);
  ok(!set.has("it1"), "已送人的 5 星串不纳入");
  ok(set.has("it0"), "已送人 5 星被排除后集合为空 → 兜底仍生效 it0");
  ok(set.size === 1, "兜底后仅 it0 一只（无幽灵、无多余）");
}

section("G. mainStar5 未写（默认开）");
{
  const items = mkItems(3); items[0].star = 5;
  setStory({});                       // 没有 mainStar5 字段
  const set = S.mainSetOf(items, store);
  ok(set.has("it0"), "未写 mainStar5 默认纳入 5 星");
}

section("H. setMainStory 写盘 + switched 累加 + 不双写 mainId");
{
  setStory({ mainIds: [], mainStar5: true, switched: 2 });
  const w = S.setMainStory(["it0", "it2"], true);
  ok(Array.isArray(w.mainIds) && w.mainIds.length === 2, "mainIds 已写入");
  ok(w.switched === 3, "switched 从 2 累加为 3");
  ok(w.mainStar5 === true, "mainStar5 保持 true");
  ok(!("mainId" in w), "不双写旧单值 mainId");
  const round = JSON.parse(h.store.getItem("ww_story"));
  ok(round.switched === 3 && round.mainIds.length === 2, "落盘一致");
}

section("I. 旧单值 mainId 折算（只读不双写）");
{
  const items = mkItems(3);
  setStory({ mainId: "it1" });        // 老存档单值
  const set = S.mainSetOf(items, store);
  ok(set.has("it1"), "旧单值折算进集合");
  const still = JSON.parse(h.store.getItem("ww_story"));
  ok(!("mainIds" in still), "折算后不回写 mainIds（不双写）");
}

const pass = summary();
process.exit(pass ? 0 : 1);

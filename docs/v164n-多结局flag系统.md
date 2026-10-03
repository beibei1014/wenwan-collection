# v164n · 多结局 flag 系统（可判定存档数据 + 岁除判定逻辑）

> 作者：互动设计师 游心流　｜　状态：设计规格（**不含引擎代码**，仅数据模型 + 判定逻辑，供架构师落地）
> 上游：`v164n-修订-关系与冲突框架.md` §三（四结局触发条件）、`v164l-情感系统设计.md` §1.2（羁绊八档）、`v164l-主线-v6.md`（26 章门槛 / H1–H5 / 岁除窗口）
> 铁律衔接：剧本与代码解耦（§全局铁律1）；一切可配置（§2）；条件表达式化（§4）；不杜撰素材（§6）
> ⛔ **本文件只设计「数据契约 + 判定逻辑」，不写任何 js。落库字段类比 `rec.marks` 的扁平键值形态，但**不进 `rec.marks`**（避开其字典序裁剪 bug，见 §五）**。

---

## 〇、定位：这套 flag 解决什么

岁除（天劫）那一刻，需要一份**确定、可读、可存档**的状态，由它唯一决定结局。

- 天劫是**每只沁灵独自撑一次**（v164n §2.1）。所以「散」是**逐串**事件，结局是**全局**裁定。
- 玩家的行为（盘玩/陪伴）**永远滋养、绝不伤害**（v164n §4.2 承重墙）。**系统绝不主动杀**——任何「散」都必须能回溯到「玩家选了替它决定 + 亲密度不足」。
- 因此 flag 系统只回答两件事：**玩家在这只身上是「替它决定」还是「让它自己来」**；**它的亲密度够不够当护盾**。其余（资源分配、关键选择对错）作为辅助轴参与大团圆/HE 的门槛。

**不变量（本文件的最高约束，见 §四 逐条自检）：**

| # | 不变量 |
|---|---|
| I1 | **BE 仅当**：存在至少一只 `stance==DECIDE` 且 `bondLv < SHIELD_MIN` |
| I2 | **大团圆/HE 当且仅当**：`dominantLet` 为真 且 `allHighBond` 为真（再加各自门槛） |
| I3 | **NE 为中间态**：无人散，但未达大团圆/HE |
| I4 | **系统绝不主动杀**：`scattered` 只能由 `DECIDE + 亲密度不足` 推出，绝不凭空置真 |

---

## 一、核心设计轴

| 轴 | 载体 | 类型 | 说明 |
|---|---|---|---|
| **A. 替它决定 vs 让它自己来** | 每只 `stance` + 全局 `FORK_STANCE` | enum | 贯穿全 26 章的核心二选一（v164n §3.2，H1/H2 两种帮法）。**BE 的种子埋在每一次「替它选」里** |
| **B. 亲密度 = 天劫护盾** | 每只 `bondLv`（int 1–8） | int/enum | 羁绊八档（v164l §1.2）。低于 `SHIELD_MIN` 的 DECIDE 串会在天劫里散 |
| **C. 关键选择对错** | `KEY_CHOICES`（int） | int | 「护对了该护的」次数（三个 H3 挡关门：ch7/ch11/ch19） |
| **D. 齐心协力准备** | `JOINT_PREP`（enum） | enum | 岁除前资源分配合理 / 并肩准备的程度（ch22–ch24） |

> 轴 A/B 为**必需轴**（直接决定 BE 与好结局的有无）；轴 C/D 为**辅助轴**（决定大团圆/HE 的层级，不影响「是否散」）。

---

## 二、完整 flag 表

> 命名：全局 flag 用 `UPPER_SNAKE`；逐串 flag 以 `rec.flags.<field>` 形态挂在每只沁灵的存档上。
> 类型代号：enum / int / bool。

### 2.1 全局 · 本周目 flag（存于 `ww_story`，见 §五）

| 名称 | 类型 | 默认值 | 设置点（章） | 含义 / 作用 |
|---|---|---|---|---|
| `FORK_STANCE` | enum {UNSET, DECIDE, LET, MIXED} | `UNSET` | 在每次 H1/H2 节点后按逐串 tally 重算，终值在 **ch21（中岁除·谁跟你并肩）** | 玩家整体姿态：偏「替它决定」还是「让它自己来」。判定 `dominantLet` 的主依据 |
| `KEY_CHOICES` | int（0..`KEY_TOTAL`） | `0` | **ch7 挡关 / ch11 三次用完了 / ch19 一个人的关口**（三个 H3 门），每「护对」+1 | 关键选择做对次数；满 `KEY_TOTAL` 视为「关键选择全对」→ 大团圆/HE 门槛之一 |
| `KEY_TOTAL` | int（常量） | `3` | 固定设计常量（可进配置） | `KEY_CHOICES` 的分母 |
| `JOINT_PREP` | enum {NONE, PARTIAL, FULL} | `NONE` | **ch22 大岁除前的引市 / ch23 三百六十天 / ch24 榜挂出来了**（岁除前准备段），按是否完成并肩/分配动作升级 | 齐心协力 / 资源分配合理的程度；`FULL` 是大团圆专属门槛 |

### 2.2 逐串 · 每只沁灵 flag（存于 `rec.flags`）

> 仅「在册且参与岁除」的沁灵需要（ch26 时在册规模，见 v164l 主线 v6 门槛表；轻度玩家经岁除补看窗口仍可达 ch26）。

| 名称 | 类型 | 默认值 | 设置点（章） | 含义 / 作用 |
|---|---|---|---|---|
| `stance` | enum {UNSET, DECIDE, LET} | `UNSET` | 该只的 H1/H2 决定点（早场 ch5/ch6；中场 ch14/ch16；晚场 ch20/ch21）；最终值取 ch26 前最后一次写入 | **核心轴 A**：玩家在这只身上是「替它决定」（H1）还是「让它自己来」（H2）。`DECIDE` 是 BE 的必要条件 |
| `bondLv` | int（1..8） | 实时从 `rec.bond` 推导，岁除时缓存 | **ch26 岁除判定前**读取 `bondLevel(rec)` 缓存 | **核心轴 B：天劫护盾值**。八档之一（照面1…沁透8）。与 `SHIELD_MIN` 比较决定该只是否散 |
| `scattered` | bool | `false` | **ch26 岁除判定时由逻辑写出（派生，非玩家选择）** | 该只是否在天劫里散。仅当 `stance==DECIDE && bondLv<SHIELD_MIN` 为真。供结局演出回显「那只」 |

### 2.3 判定常量（集中配置，不硬编码 —— 对应铁律2）

| 常量 | 值 | 含义 | 取档依据（v164l §1.2） |
|---|---|---|---|
| `SHIELD_MIN` | `5`（通意，bond≥90） | DECIDE 串的散阈值：`bondLv < 5` 即「亲密度不足」 | 照面/眼熟/相熟/同室（lv1–4）扛不住被替做主的天劫；通意及以上可代偿 |
| `HE_BOND` | `6`（同心，bond≥140） | 「高亲密度」门槛：全员 `bondLv ≥ 6` 才视为够亲 | 同心起才是「家人+心跳」，对应大团圆/HE 的温情基线 |
| `KEY_TOTAL` | `3` | 关键选择总数 | 三个 H3 挡关门（ch7/ch11/ch19） |
| `HE_ALLOW_DECIDED` | `false` | 设计裁定开关：纯 DECIDE 但全员存活高亲，是否算 HE | 默认 `false` 以严守不变量 I2（见 §四 备注） |

> ⛔ 这些常量**必须进配置表**，不在判定逻辑里写死。阈值若调整，只需改配置，逻辑不变。

---

## 三、岁除（天劫）判定伪代码

> 输入：全局 `ww_story` + 逐串 `rec.flags`（含实时 `bondLv`）。
> 输出：单一结局 `ENDING ∈ {GRAND, HE, NE, BE}` + 逐串 `scattered[]`。
> 性质：**确定性、可重放、无随机、无模糊描述**。

```
// ===== 0. 配置常量（集中配置，不硬编码）=====
SHIELD_MIN       = 5     // 通意：DECIDE 串 bondLv < 5 → 散
HE_BOND          = 6     // 同心：全员 ≥ 6 视为「高亲密度」
KEY_TOTAL        = 3     // 三个 H3 挡关门（ch7/ch11/ch19）
HE_ALLOW_DECIDED = false // 设计裁定：纯 DECIDE 但全员存活高亲，是否算 HE（默认否）

// ===== 1. 输入 =====
story   = ww_story                      // { FORK_STANCE, KEY_CHOICES, JOINT_PREP }
spirits = [ rec.flags{ stance, bondLv }  for 在册且参与岁除的每只 ]   // bondLv 岁除前已缓存

// ===== 2. 逐串天劫存活判定（系统绝不主动杀：scattered 仅由 DECIDE+不足 推出）=====
for s in spirits:
    s.scattered = ( s.flags.stance == "DECIDE" ) && ( s.flags.bondLv < SHIELD_MIN )

// ===== 3. 聚合 =====
anyScattered = spirits.exists( s => s.scattered )
allHighBond  = spirits.all(    s => s.flags.bondLv >= HE_BOND )
dominantLet  = ( story.FORK_STANCE == "LET" )
               || ( count(stance=="LET") >= count(stance=="DECIDE") )
keysRight    = ( story.KEY_CHOICES >= KEY_TOTAL )
jointFull    = ( story.JOINT_PREP == "FULL" )

// ===== 4. 结局裁定 =====
if anyScattered:
    return ENDING.BE        // 至少一只被散 → 虐文 BE（源自玩家替它决定 + 亲密度不足）

if dominantLet && allHighBond && keysRight && jointFull:
    return ENDING.GRAND     // 大团圆

if HE_ALLOW_DECIDED
   ? ( allHighBond && keysRight )                                  // 放宽：纯 DECIDE 但全员存活高亲也算 HE
   : ( dominantLet && allHighBond && keysRight ):
    return ENDING.HE         // HE

return ENDING.NE             // 中间态：无人散，但没到全好
```

### 3.1 四种结局的落点（与 v164n §3.1 对齐）

| 结局 | 触发（本系统表达式） | 收束 |
|---|---|---|
| **大团圆 GRAND** | `dominantLet && allHighBond && keysRight && jointFull` | 全家一起过劫，岁除并肩（v164n：齐心协力+关键选择全对+亲密度普遍够） |
| **HE** | `dominantLet && allHighBond && keysRight` （且非 GRAND） | 有人小伤但都在，关系更深（v164n：护对+亲密度够） |
| **NE** | 无人散，但未满足 GRAND/HE | 有人缺席岁除但活着，来年再补（v164n：撑不住但没散/差一线） |
| **BE** | `anyScattered`（∃ 串 `DECIDE && bondLv<SHIELD_MIN`） | 那只被天劫散掉——源自玩家此前的「替它决定」+ 亲密度不足 |

---

## 四、不变量自检（逐条过）

| 不变量 | 判定逻辑如何保证 | 结果 |
|---|---|---|
| **I1 · BE 仅当 DECIDE+不足** | `anyScattered` 为真 ⇔ 存在 `stance==DECIDE && bondLv<SHIELD_MIN` 的串；BE 仅由 `anyScattered` 触发 | ✅ |
| **I2 · 大团圆/HE 需 LET+高亲** | GRAND/HE 分支首条件均为 `dominantLet && allHighBond`；`dominantLet` 要求整体姿态偏 LET（或 LET 数 ≥ DECIDE 数） | ✅ |
| **I3 · NE 为中间态** | 无 `anyScattered` 且未满足 GRAND/HE 时一律落 NE，覆盖所有「活着但没全好」的组合 | ✅ |
| **I4 · 系统绝不主动杀** | `scattered` 只能由 `DECIDE + bondLv<SHIELD_MIN` 置真；`stance==LET` 或 `UNSET` 的串 `scattered` 恒为 `false`；非 DECIDE 的低亲密串只导向 NE（活着），绝不散 | ✅ |

> **⚠️ 设计裁定备注（I2 的边界）**：默认 `HE_ALLOW_DECIDED = false`。
> 含义——若玩家**全程替每只做主**（FORK_STANCE=DECIDE），但亲密度都够、关键选择全对、全员存活，按不变量 I2 它**不配大团圆/HE，落 NE**（"你把它们都养活了，但没真正成为并肩的一家人"）。
> 若主理人认为"养活且高亲"应算 HE，将 `HE_ALLOW_DECIDED` 改为 `true` 即可——此时 HE 条件去掉 `dominantLet`，纯 DECIDE 但全员存活高亲的周目可达成 HE（仍不可达 GRAND，GRAND 仍锁 LET）。**该开关已预留，不在逻辑里写死。**

---

## 五、与 `rec.marks` 的存储衔接建议（数据模型 + 判定逻辑，不含代码）

### 5.1 为什么**不进 `rec.marks`**

`v164l-情感系统设计.md` §7.4 已确认：`pruneForQuota`（`spirits.js:342-344`）按 `localeCompare` 排序后 `pop()`，导致 `c11_` < `c2_`，**会误删章序靠后的记痕**。本 flag 系统的字段语义与记痕无关，且需**长期稳定可读、不可被裁剪**，因此：

- ⛔ **不写入 `rec.marks`**。
- ✅ **沿用 `rec.marks` 的「扁平键值」形态**，但落在**独立、不被 prune 的字段**里。

### 5.2 数据模型（架构师照此落地，不写引擎）

**A. 逐串 flag —— 挂在每只沁灵的 `rec` 上（与 `rec.giftLog`/`rec.heartLog` 同层）：**

```jsonc
// 每只沁灵 rec（参与岁除者）
{
  // …既有字段（bond / stage / marks / giftLog / heartLog 等）…

  "flags": {                 // 新增：扁平键值，类比 marks 但独立、不进 prune
    "stance":     "UNSET",   // enum: UNSET | DECIDE | LET
    "bondLv":     1,         // int 1..8，岁除前由 bondLevel(rec) 缓存
    "scattered":  false      // bool，岁除判定写出（派生）
  }
}
```

**B. 全局 flag —— 本周目级，存于独立存档对象 `ww_story`（localStorage，与 `ww_spirits` 同层；或云端同形状表，类比 `gift_store`）：**

```jsonc
// ww_story（本周目级状态，非逐串）
{
  "v": 1,
  "FORK_STANCE":  "UNSET",   // enum: UNSET | DECIDE | LET | MIXED
  "KEY_CHOICES":  0,         // int 0..KEY_TOTAL
  "KEY_TOTAL":    3,         // int 常量镜像（便于回放/调试）
  "JOINT_PREP":   "NONE",    // enum: NONE | PARTIAL | FULL
  "at": "<dayKey>"           // 最近写入日，便于时序审计
  // 注：SHIELD_MIN / HE_BOND / HE_ALLOW_DECIDED 为「判定配置」，不要求存入存档，
  //     由配置表读取；此处仅镜像 KEY_TOTAL 以利回放。
}
```

### 5.3 写入时机（与主线节点对齐）

| flag | 写入时机 | 幂等性 |
|---|---|---|
| `rec.flags.stance` | 每次 H1/H2 节点后写入该只；最终值 = ch26 前最后一次 | 覆盖写（取最新） |
| `rec.flags.bondLv` | ch26 岁除判定前，由 `bondLevel(rec)` 读后缓存 | 只读派生，缓存一次 |
| `rec.flags.scattered` | ch26 判定逻辑写出 | 每次判定重算覆盖 |
| `ww_story.FORK_STANCE` | 每次 H1/H2 后按逐串 tally 重算；终值 ch21 | 覆盖写 |
| `ww_story.KEY_CHOICES` | ch7/ch11/ch19 每「护对」+1（不扣分、不回退） | 单调增 |
| `ww_story.JOINT_PREP` | ch22–ch24 按准备动作升级（NONE→PARTIAL→FULL） | 只升不降 |

### 5.4 判定入口（架构师落地建议，非代码）

```
resolveEnding():
  1. 读 ww_story → story
  2. 收集在册且参与岁除的 rec，确保每只 rec.flags.bondLv 已缓存
  3. 执行 §三 伪代码 → ENDING + 逐串 scattered
  4. 将 scattered 写回各 rec.flags.scattered
  5. 返回 ENDING 给演出层（ch26「都好好的」按 ENDING 分支）
```

> 判定是**纯函数**：相同 `ww_story` + 相同逐串 `flags` → 永远相同结局。这支撑存档、回放、调试面板。

---

## 六、章节设置点对照（来自 v164l 主线 v6 门槛表）

| 章 | 天数 | 帮法 | 本系统动作 |
|---|---|---|---|
| ch5 第一次岔口 | 62 | H1 | 早场 H1/H2：写入相关串 `stance`；刷新 `FORK_STANCE` |
| ch6 它不同意 | 78 | H2 | H2 即「让它自己来」：相关串 `stance=LET` |
| ch7 挡关 | 95 | H3 | 「护对」→ `KEY_CHOICES +1` |
| ch11 三次用完了 | 155 | H3 | 「护对」→ `KEY_CHOICES +1` |
| ch14 两个引者的交易 | 212 | H1 | 中场 H1/H2：写入相关串 `stance` |
| ch16 各自的道 | 248 | H1 | 中场核心 autonomy 节点：写入相关串 `stance` |
| ch19 一个人的关口 | 302 | H3 | 「护对」→ `KEY_CHOICES +1`（至此 `KEY_TOTAL=3` 封顶） |
| ch20 见证 | 320 | H5 | 晚场：写入相关串 `stance` |
| ch21 中岁除·谁跟你并肩 | 336 | H4 | **`FORK_STANCE` 终值定型**（逐串 tally） |
| ch22 大岁除前的引市 | 345 | H4 | 岁除前准备：可升 `JOINT_PREP` |
| ch23 三百六十天 | 352 | H5 | 岁除前准备：可升 `JOINT_PREP` |
| ch24 榜挂出来了 | 358 | — | `JOINT_PREP` 定型（FULL/PARTIAL/NONE） |
| ch26 都好好的 | 360 | — | **岁除判定**：缓存 `bondLv` → 执行 §三 → 写 `scattered` → 出结局 |

> 轻度玩家若卡在阶位门，经岁除补看窗口（ch4/ch9/ch15/ch21/ch26，v164l 主线 v6 §五）仍可读到 ch26，判定逻辑对「补看」周目同样适用（`JOINT_PREP`/`KEY_CHOICES` 按补看不计入的口径处理，见 v164l §10.2：补看不给引位、不计入在场）。

---

## 七、可解性 / 边界自查

| 场景 | stance 组合 | bondLv | 判定结果 | 符合不变量？ |
|---|---|---|---|---|
| 全程让它自己来 + 全员高亲 + 选择全对 + 齐心协力 | 全 LET | 全 ≥6 | **GRAND** | ✅ I2 |
| 全程让它自己来 + 全员高亲 + 选择全对 + 准备一般 | 全 LET | 全 ≥6 | **HE** | ✅ I2 |
| 全程让它自己来 + 全员高亲 + 选择有错 | 全 LET | 全 ≥6 | **NE** | ✅ I3 |
| 让它自己来 + 个别低亲（但非 DECIDE） | 多 LET，少数低 bond | 有 <6 | **NE**（活着，差一线） | ✅ I3/I4 |
| 替它决定 + 亲密度不足（任一只） | 含 DECIDE 且 bond<5 | 混合 | **BE**（那只散） | ✅ I1/I4 |
| 替它决定 + 亲密度够（全员 DECIDE 但都 ≥5） | 全 DECIDE | 全 ≥5 | `HE_ALLOW_DECIDED=false` → **NE**；`=true` → **HE** | ✅ 由开关裁定（§四备注） |
| 玩家从未对该只做 autonomy 决定（UNSET） | 含 UNSET | 任意 | UNSET 不算 DECIDE → 不会 BE；按 `dominantLet` 计 | ✅ I4（未替它决定则不散） |

**可达性结论：**
- 四结局**全部可达**。
- **BE 永远需要玩家显式「替它决定」+ 疏于养**（bond<SHIELD_MIN），系统绝不主动触发。
- **大团圆/HE 永远需要「让它自己来」+ 高亲**，无法靠「替它做主」刷出。
- 不存在死路：任何 flag 组合都唯一落到一个结局（判定是**全覆盖的分支链**，末行为 `return NE` 兜底）。

---

## 八、待架构师落地项（本文件不写代码，仅列清单）

| # | 项 | 说明 |
|---|---|---|
| 1 | 新增 `rec.flags` 字段 | 三只键：`stance` / `bondLv` / `scattered`；不进 `rec.marks` |
| 2 | 新增 `ww_story` 存档对象 | 四个键：`FORK_STANCE` / `KEY_CHOICES` / `KEY_TOTAL` / `JOINT_PREP`；形态类比 `gift_store` |
| 3 | 判定配置表 | `SHIELD_MIN=5` / `HE_BOND=6` / `KEY_TOTAL=3` / `HE_ALLOW_DECIDED=false`，集中配置不硬编码 |
| 4 | 写入钩子 | 在 §六 各章节点调用写入（H1/H2→stance/FORK_STANCE；H3→KEY_CHOICES；ch22–24→JOINT_PREP；ch26→bondLv 缓存 + 判定） |
| 5 | `resolveEnding()` 纯函数 | 实现 §三 伪代码；输出 ENDING + 逐串 scattered |
| 6 | 补看周目口径 | 补看章不写 `KEY_CHOICES`/`JOINT_PREP`/不计入在场（对齐 v164l §10.2） |

---

*—— 游心流 · v164n 多结局 flag 系统（设计规格，不含引擎代码）*

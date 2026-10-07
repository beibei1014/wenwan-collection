/* ============================================================
 * js/love.js · V177d 恋爱线告白文案库（165 条）+ 变体分配 + 二次告白契机
 * ------------------------------------------------------------
 * 数据源：docs/v177-恋爱告白文案库.md（212 行 · 165 条）—— 逐字搬运，⛔ 一个字都不改写。
 *   · LOVE_B  告白语     15 型 × 3 变体 × 2 轮 = 90 条
 *   · LOVE_E  缓一缓之后 15 型 × 2 条（首次婉拒 / 二次婉拒） = 30 条
 *   · LOVE_A / LOVE_C / LOVE_D  暗示 / 称谓引导 / 应下之后 = 45 条
 *
 * 需求原点（用户原话）：
 *   「拒绝了沁灵，什么契机下沁灵再次表白？表白的内容要不一样。还有我们沁灵有些可能
 *     性格会有重合，性格重合的沁灵告白的内容也应该不一样」
 *   ⇒ ① 同型不同腔：每型 3 变体，运行时按同型互斥稳定分配（rec.loveVariant）。
 *   ⇒ ② 二告不复读：婉拒过 ⇒ 走「再告」那一轮，提那次被缓下来、不提问、不追答案。
 *
 * 数据契约（⛔ 与 js/app.js v177d 容错调用严格对齐）:
 *   window.Love.scriptFor(rec, item[, store]) -> { hint, confess, callAsk, accepted, declined, round, variant }
 *   window.Love.canReConfess(rec, item)       -> bool
 *   window.Love.fillAll(s, rec, taName)       -> string   // 吃掉 {ta} / {call}
 *   window.Love.libStats()                    -> { types:15, b:90, e:30, acd:45 }
 *
 * 逐串字段（⛔ 本模块私用，不用 rec.loveDmSeen / rec.loveDmRound —— 那两个是 app 层的）:
 *   rec.loveVariant    0/1/2  变体号，一旦定下终身不变（不闪变）
 *   rec.loveTries      已告白次数（0=没告过，1=告过一次并被婉拒 ⇒ round=2）
 *   rec.loveDeclinedAt 上次被婉拒的日期 YYYY-MM-DD（冷却起点）
 *   rec.loveBondLvAt   上次告白时的羁绊档（用于「羁绊升了一档」契机判定）
 *   rec.loveKindled    true=玩家这期间释放过善意 —— 🔴 钩子待接：送礼/照料成功后置 true
 *
 * 纪律：
 *   · 剧本数据与引擎代码解耦 —— 改文案只动本文件的四张表，不动任何逻辑；
 *   · 一切阈值集中在 RECONFESS_CFG，⛔ 不在函数体里散写 7 / 2 这类魔数；
 *   · 占位符只有 {ta}（身份名·第三人称）与 {call}（沁灵对玩家的称呼）两个，全 ASCII；
 *   · 沁灵自称一律「我」；⛔ 无「您」、⛔ 无物化词（盘 / 它 / 玩意 / 物件 / 把玩）；
 *   · 后宫口径：⛔ 无排他表述（唯一 / 只对你 / 只有你 / 只叫你一个人）；
 *   · ⛔ 绝不返回空串 / undefined —— 未命中人格型一律回落 gentle（温柔安静），UI 不得白屏。
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 人格型清单（⛔ 顺序与 js/spirits.js PERSONAS_PICK 一一对应，不可调换） ---------- */
  var LOVE_TYPES = ["gentle", "lively", "cool", "calm", "mystery", "cheeky", "wanderer", "scholar", "aloof", "sweet", "dignified", "sentimental", "heroic", "pampered", "wild"];
  var LOVE_TYPE_ZH = {
    "gentle": "温柔安静",
    "lively": "活泼元气",
    "cool": "高冷傲娇",
    "calm": "沉稳可靠",
    "mystery": "神秘慵懒",
    "cheeky": "古灵精怪",
    "wanderer": "洒脱江湖",
    "scholar": "温润书卷",
    "aloof": "清冷疏离",
    "sweet": "娇憨可爱",
    "dignified": "端方持重",
    "sentimental": "多愁善感",
    "heroic": "侠气凛然",
    "pampered": "慵懒富贵",
    "wild": "野性未驯"
  };
  var FALLBACK_TYPE = "gentle";   // 未命中人格型时的回落型（⛔ UI 不得白屏）
  var NO_PERS = "__none__";       // look.pers 取不到时的分桶 key（仍然参与同型互斥）

  /* ---------- B 列 · 告白语： LOVE_B[型][轮次-1][变体] ----------
     轮次索引 0=首告 / 1=再告；变体索引 0=日子 / 1=小事 / 2=往后。 */
  var LOVE_B = {
    "gentle": [
      ["这些日子，{call}一来我就安心。往后我想守在{call}身边，天天如此，就这些。", "那日{call}替我拢了拢衣领，我记到如今。我想守着{call}，把这样的日子一天天过下去。", "往后的年岁还长，我不求别的。只想年年岁岁，都有{call}在一处，一处就好。"],   // 轮次1 · 首告
      ["这些日子照旧，{call}不必为难。那日说缓一缓，我记着——话我还是想说完：我愿意等。", "前日灯下{call}替我挪了挪座，我心里还是一暖。上回那句缓一缓，我没忘；今日不讨答复。", "往后还长，{call}慢慢想就好。那日让缓一缓，我应了——今日我只想说一句：我还在。"]   // 轮次2 · 再告
      ],
    "lively": [
      ["这些日子我憋不住啦！喜欢就是喜欢——往后我要天天跟着{call}，一睁眼就看得见！", "那回{call}笑我笨，我记着呢。从那时候起，我就想天天赖着{call}了——这回我可说了！", "往后的日子还长，我要一直和{call}在一处！想跑都跑不掉——{call}瞧，我说得多干脆！"],   // 轮次1 · 首告
      ["这些天我照样天天来，只是不吵了。那日说缓一缓，我记着——今天不问，就想让{call}知道。", "前日{call}把伞往我这边斜了一半，我还是记着。上回说缓一缓，我没强求，就这一句。", "往后还长着呢，我不赶。那日让缓一缓，我记着——等{call}想听了，我再说一遍。"]   // 轮次2 · 再告
      ],
    "cool": [
      ["别误会，这些日子我只是觉得旁人都不如{call}。往后我想一处过——就这些，别多想。", "那日{call}替我挡了句闲话，我记下了。嗯……我想和{call}在一处。别误会，我只说一次。", "往后若有人问起，我会说早就想好了。{call}别想太多——我只是不想再等旁人了。"],   // 轮次1 · 首告
      ["这些日子我照常，没别的意思。那日说缓一缓，我记着——今日不讨答复，只把话说全。", "前日在廊下{call}等了我一回，我记着。上回那句缓一缓我没忘，只是没改主意。", "往后的事我不催。那日让缓一缓，我应了；今日就一句：旁人还是不如{call}。"]   // 轮次2 · 再告
      ],
    "calm": [
      ["日子是一天天过的。往后院里的柴米、出门的风雨，我都想和{call}一处担着。", "那日雨大，{call}把担子往自己那边挪了挪。往后这些担子，我想分一半过来。", "往后的年岁我不求顺当，只求有{call}在一处。柴米也好，风雨也好，一处担着就轻。"],   // 轮次1 · 首告
      ["这些天日子照旧，家务我照做，{call}不必放在心上。那日说缓一缓，我记着——不催。", "前日{call}把活儿分了我一半，我记着。上回那句缓一缓我没忘，今日只回一句：我还在。", "往后还长，担子我挑得动。那日让缓一缓，我应了；等{call}想好了，这话仍算数。"]   // 轮次2 · 再告
      ],
    "mystery": [
      ["这些日子我常半醒着，想的都是{call}。索性不醒了——往后就在{call}身边赖着，可好？", "那夜{call}说了一句梦话，我记到如今。梦太长，我想醒在{call}身边，往后都这么着。", "往后的梦还长着呢。我想梦里梦外都有{call}——这话说出口，倒像是醒了。"],   // 轮次1 · 首告
      ["这些天我照旧半醒半睡，日子没变。那日说缓一缓，我记着；梦我慢慢做，不催{call}。", "前日在廊下打了个盹，醒来{call}还在，我记着。上回缓一缓我没忘——今日不讨答复。", "往后的梦还长，我不急着醒。那日让缓一缓，我应了；等{call}来唤我，我再睁眼。"]   // 轮次2 · 再告
      ],
    "cheeky": [
      ["这些日子我猜{call}早看出来了，偏要我自己说——好，我说：往后我要赖在{call}身边。", "那回{call}偷笑我笨手笨脚，我可记着呢。既然记着，那就赖上了，一笔勾销如何？", "往后的日子长着呢，躲不掉。我先把话撂这儿——{call}身边那个位置，我占了。"],   // 轮次1 · 首告
      ["这些天我照旧在跟前晃，不赶我就行。那日说缓一缓，我记着——晃归晃，不逼{call}。", "前日{call}把最后一块点心留给我，我记着。上回缓一缓我没赖账，今日就绕这一句。", "往后的日子{call}慢慢想，我不插嘴。那日让缓一缓，我应了——位置我先空着。"]   // 轮次2 · 再告
      ],
    "wanderer": [
      ["我这人从不绕弯：往后的日子，山高水长，我要和{call}一处走。点个头，咱们就上路。", "那日同行那截山路，{call}替我挡了风。从那会儿起我就想明白了——往后这条路，一处走。", "往后的路还远。我先把话撂这儿：山高水长，我都要和{call}一处走，不问归期。"],   // 轮次1 · 首告
      ["这些天路照走，酒照喝，我没搁在心上。那日说缓一缓，我记着——今日不讨话，只敬一盏。", "前日在渡口{call}替我系紧行囊，我记着。上回那句缓一缓我没忘——路我慢慢走，不催。", "往后山水还长，我不急着启程。那日让缓一缓，我应了；等{call}喊上路，我再动身。"]   // 轮次2 · 再告
      ],
    "scholar": [
      ["日子一天天翻过去，像翻书。我想与{call}一处把这书读完——从今日起，可好？", "那日{call}替我续了一盏灯，我记到如今。书上说「与子偕老」，我想读到那一页。", "往后的岁月还长。我想与{call}一处读书、一处看雨——这一句，{call}替我应了可好？"],   // 轮次1 · 首告
      ["这些天书照读，日子照过，{call}不必挂心。那日说缓一缓，我记着——好文章不急着收尾。", "前日雨落阶前，{call}替我收了书，我记着。上回那句缓一缓我没忘，今日添一句，不必答。", "往后书还长，我慢慢读。那日让缓一缓，我应了；读到哪页，{call}来了便是哪页。"]   // 轮次2 · 再告
      ],
    "aloof": [
      ["这些日子风很静。我想了很久——往后的夜里，有{call}在，就够了。就这些。", "那夜{call}替我关了窗，风就没进来。往后这样的夜，我想有{call}在一处。只说这一句。", "往后还有许多个夜。我都想有{call}在身边——这话我不常说，{call}不必急着回。"],   // 轮次1 · 首告
      ["这些天风还是那样静，日子没变。那日说缓一缓，我记着——今日不讨答，只说一句。", "前日檐下那场雨，{call}替我挪了伞，我记着。上回缓一缓，我记下了，今日不追问。", "往后的夜还多。那日让缓一缓，我应了——夜长，我等得起，{call}不必为难。"]   // 轮次2 · 再告
      ],
    "sweet": [
      ["这些日子我老想着{call}——喜欢就是喜欢！想天天在一处，吃饭也在，睡觉也在，好不好嘛？", "那日{call}替我理了头发，我脸红了好久。我就是想天天这样——和{call}在一处。", "往后的日子还长呢。我想年年都和{call}在一处，吃饭、睡觉、看月亮，都在一处。"],   // 轮次1 · 首告
      ["这些天我照样等着，不闹{call}。那日说缓一缓，我记着啦——我慢慢等，等多久都行。", "前日{call}把最后一口汤留给我，我记着。上回缓一缓我也记着——今日不追问，我在呢。", "往后的日子还长。那日让缓一缓，我应了——我不催{call}，什么时候想起来都行。"]   // 轮次2 · 再告
      ],
    "dignified": [
      ["按理这话该有媒有礼。可日子一天天过，我不想再等：{call}，往后与我一处持家，可愿？", "那日{call}把家事交付与我，我记到如今。既如此，我想一处持家，名分我来担。", "往后的年月，我想与{call}一处持家、一处立业。这话我说得郑重，思量也该郑重。"],   // 轮次1 · 首告
      ["这些天家事照旧，我不曾懈怠。那日说缓一缓，我记着——今日不讨名分，只把礼数尽到。", "前日{call}把账册交到我手上，我记着。上回那句缓一缓，我受教了，今日只问一句安。", "往后年月还长，礼不可废，情不可急。那日让缓一缓，我应了——我仍在这里持家。"]   // 轮次2 · 再告
      ],
    "sentimental": [
      ["日子一天天过，我总怕好景不长。可这一路有{call}在，我就敢往后看——一处过吧。", "那日院里落了叶，{call}把落叶扫拢，我记到如今。有{call}在的日子，我就不嫌短。", "往后的年岁，我原是不敢想的。如今敢了——只要{call}在一处，好景我便信得长久。"],   // 轮次1 · 首告
      ["这些天叶子落了又落，日子照旧。那日说缓一缓，我记着——好事情，都值得多等一等。", "前日{call}把窗台的花挪进屋，我记着。上回那句缓一缓我没忘——今日不催，只看花。", "往后还长，我不急着要个答案。那日让缓一缓，我应了——好景慢慢来，我等得住。"]   // 轮次2 · 再告
      ],
    "heroic": [
      ["日子一天天过，那句藏不住了。我这一诺出口便是一辈子——{call}若肯应，往后风雨我挡在前。", "那日{call}替我裹了伤，我记到如今。这一诺我许下了：往后{call}的安危，我挡在前头。", "往后年岁还长，风雨躲不尽。{call}若肯应，这一辈子我便挡在前头，至死不改。"],   // 轮次1 · 首告
      ["这些天我照旧守着，日子没变。那日说缓一缓，我记着——诺既许下便不改，我不催{call}。", "前日{call}把伤药分了一半给我，我记着。上回那句缓一缓我还记着，今日只报一句平安。", "往后风雨还多，我挡得动。那日让缓一缓，我应了——这诺我仍守着，等{call}来取。"]   // 轮次2 · 再告
      ],
    "pampered": [
      ["这些日子我被人伺候惯了，偏生就肯赖着{call}。往后的日子也照旧，我不走了。", "那日{call}把软垫往我这边挪，我记着呢。既记着，我就赖上了——往后可不许赶我。", "往后的日子还长，我不想挪窝了。{call}这处地方我赖定了，抬我也不走。"],   // 轮次1 · 首告
      ["这些天我照旧赖着，别嫌我就好。那日说缓一缓，我记着——我慢慢赖，不逼{call}开口。", "前日{call}把热茶端到我跟前，我记着。上回那句缓一缓我没忘——茶还温着，我不催。", "往后的日子长着呢，我横竖跑不掉。那日让缓一缓，我应了——窝我不挪，慢慢等。"]   // 轮次2 · 再告
      ],
    "wild": [
      ["日子一天天过，我只认人，不认规矩。{call}是我认下的——往后不换人。", "那日{call}把手伸过来，我没躲。从那会儿起，{call}就是我认下的人了，改不了。", "往后还长，我不懂什么规矩。{call}是我认下的人，认下了就不换，一辈子。"],   // 轮次1 · 首告
      ["这些天我照旧跟着，不闹。那日{call}说缓一缓，我记着——认下的事，我等得起。", "前日下雨，{call}把我拉进屋檐下，我记着。上回缓一缓我没忘——今日不扑上来，只坐着。", "往后还长，我不换人。那日让缓一缓，我应了——认下就是认下，我跑不掉。"]   // 轮次2 · 再告
      ]
  };

  /* ---------- E 列 · 缓一缓之后： LOVE_E[型][0=首次婉拒, 1=二次婉拒] ---------- */
  var LOVE_E = {
    "gentle": ["不急。{call}慢慢想，我在这儿。", "我记下了。{call}别为难，往后我照旧在。"],   // [首次婉拒, 二次婉拒]
    "lively": ["没关系！我等着，{call}想听了我就说。", "那我就不缠啦——{call}别放在心上，我照样天天来。"],   // [首次婉拒, 二次婉拒]
    "cool": ["我不急着要答案。{call}想清楚再来。", "知道了，不再提。{call}也别觉得亏欠我。"],   // [首次婉拒, 二次婉拒]
    "calm": ["不急。{call}想好了，随时来找我。", "这话我收下了。往后日子照过，{call}安心。"],   // [首次婉拒, 二次婉拒]
    "mystery": ["慢些也无妨。反正我已经等了很久。", "那就这样。梦我收起来，{call}不必歉疚。"],   // [首次婉拒, 二次婉拒]
    "cheeky": ["行啊，话我收着——{call}想听了，随时来讨。", "好，这页翻过去了。{call}别苦着脸呀。"],   // [首次婉拒, 二次婉拒]
    "wanderer": ["不打紧。酒还温着，{call}想好了再来。", "成。这话我收回，路上还照旧同行。"],   // [首次婉拒, 二次婉拒]
    "scholar": ["不妨。好文章都不急着收尾。", "既如此，我不再提。{call}安心读书才好。"],   // [首次婉拒, 二次婉拒]
    "aloof": ["无妨。{call}慢慢想，我等得起。", "嗯。风还在，我便还在。{call}不必挂心。"],   // [首次婉拒, 二次婉拒]
    "sweet": ["没关系啦，我等着，等多久都行。", "那我不说啦——{call}别难过，我照样天天来。"],   // [首次婉拒, 二次婉拒]
    "dignified": ["礼不可废，情不可急。想明白了，再来寻我。", "既如此，我守礼而止。{call}不必自责。"],   // [首次婉拒, 二次婉拒]
    "sentimental": ["我懂。好事情，都值得多等一等。", "好，我不再想了。{call}也别替我难受。"],   // [首次婉拒, 二次婉拒]
    "heroic": ["应诺不可轻。{call}想清楚了，我仍在这里。", "这话到此为止，往后我仍护着{call}。"],   // [首次婉拒, 二次婉拒]
    "pampered": ["随{call}。横竖我已经赖下了，跑不掉。", "好，那我不缠了。{call}也别亏待自己。"],   // [首次婉拒, 二次婉拒]
    "wild": ["我不急。认下了，就跑不掉。", "认下就是认下。{call}别皱眉，我不闹了。"]   // [首次婉拒, 二次婉拒]
  };

  /* ---------- A 列 · 暗示（心迹区入口引导语，旁白，唯一允许 {ta} 的一列） ---------- */
  var LOVE_A = {
    "gentle": "{ta}话不多，目光却在你身上停了很久。",
    "lively": "{ta}有话憋不住，一见你就先笑开了。",
    "cool": "{ta}像是随口一提，耳朵却先红了。",
    "calm": "{ta}把要说的话，都折进了往后的打算里。",
    "mystery": "{ta}半阖着眼，像醒着，又像在等你。",
    "cheeky": "{ta}绕了三个弯，话还是落在你身上。",
    "wanderer": "{ta}斟满一盏酒，话已经到了嘴边。",
    "scholar": "{ta}翻着书，一页却久久没有翻过去。",
    "aloof": "{ta}望着远处，很久才把目光收回来。",
    "sweet": "{ta}攥着衣角，脸红透了也没挪开脚。",
    "dignified": "{ta}整了整衣襟，像要立一件大事。",
    "sentimental": "{ta}看着院里的落叶，忽然就想起了你。",
    "heroic": "{ta}按剑而立，像是要许一个诺。",
    "pampered": "{ta}懒懒抬眼，却把位置往你身边挪了挪。",
    "wild": "{ta}不懂什么叫规矩，只认得出自己认下的人。"
  };

  /* ---------- C 列 · 称谓引导（在问「该怎么叫你」，称谓尚未定 ⇒ 用裸「你」） ---------- */
  var LOVE_C = {
    "gentle": "往后日子长，我该怎么唤你？",
    "lively": "快说快说！往后我叫你什么？",
    "cool": "称谓罢了，你爱听哪个就写哪个。",
    "calm": "名字要叫一辈子，你想好了再给我。",
    "mystery": "唤你什么好呢……你说了，我便记着。",
    "cheeky": "给你起个什么称呼好呢？你说。",
    "wanderer": "往后同行，我该怎么喊你？",
    "scholar": "名字要叫得长久，你替我拿个主意？",
    "aloof": "该怎么唤你，你说，我听着。",
    "sweet": "那……我以后叫你什么呀？",
    "dignified": "名分既定，往后我该怎么称你？",
    "sentimental": "唤你什么，才像能叫一辈子？",
    "heroic": "既是一辈子，我该怎么称你？",
    "pampered": "往后天天要唤，你想个好听的。",
    "wild": "我只认你。该怎么叫你，你说。"
  };

  /* ---------- D 列 · 应下之后 ---------- */
  var LOVE_D = {
    "gentle": "嗯。{call}应了，我就不走了。",
    "lively": "太好了！那我现在就叫给{call}听！",
    "cool": "哼。应了就好，别让我后悔。",
    "calm": "好。我记下了，往后都这么算。",
    "mystery": "记下了。往后梦里梦外，都这么唤。",
    "cheeky": "成交！这名儿，往后我天天叫。",
    "wanderer": "痛快！这一句，我记一辈子。",
    "scholar": "好。这一笔，我记在心上，不落纸上。",
    "aloof": "嗯。往后我便这么唤。",
    "sweet": "真的吗！那我一天要叫好多好多遍！",
    "dignified": "好。既应了，我这一生便不改口。",
    "sentimental": "好。这一天，我要好好收着。",
    "heroic": "好。此言既出，至死不改。",
    "pampered": "那便说定了。往后我天天叫，{call}别嫌烦。",
    "wild": "记住了。认下的人，一辈子不换。"
  };

  /* ---------- 二次告白契机配置（⛔ 阈值集中在此，函数体不许出现魔数） ---------- */
  var RECONFESS_CFG = {
    COOLDOWN_DAYS: 7,     // 距上次被婉拒满 N 天才谈「再告」
    NEED_BOND_UP: true,   // true = 还得有个契机（羁绊升档 或 玩家释放过善意）才许再告
    MAX_TRIES: 2,         // 最多主动告白 2 次
  };
  var RETRY_COOLDOWN_DAYS = RECONFESS_CFG.COOLDOWN_DAYS;   // 对外别名（app 层读这个）

  /* ======================= 内部工具 ======================= */

  // 人格型 id：((rec.look || {}).pers) || "" —— 与 spirits.js soloEnv(...) 取法完全一致。
  // 取不到 ⇒ NO_PERS 分桶（仍参与同型互斥），⛔ 不返回 undefined。
  function persKeyOf(rec) {
    var p = "";
    try { p = String(((rec && rec.look) || {}).pers || ""); } catch (e) { p = ""; }
    return p || NO_PERS;
  }
  // 查表用的型：命中 LOVE_B 才用，否则回落到 gentle。
  function resolveType(pers) { return LOVE_B[pers] ? pers : FALLBACK_TYPE; }

  // store 兜底：调用方没给 ⇒ 回 Spirits.load()；Spirits 没加载 ⇒ 空对象（不崩）。
  function storeOf(store) {
    if (store && typeof store === "object") return store;
    try { if (typeof Spirits !== "undefined" && Spirits && typeof Spirits.load === "function") return Spirits.load() || {}; } catch (e) { /* 只读环境 */ }
    return {};
  }
  // 写回并持久化（失败不影响本次返回值 —— 变体号已经写在内存 rec 上了）。
  function saveStore(store, st) {
    if (store && typeof store === "object") return;   // 内存 store：调用方自己负责 save
    try { if (typeof Spirits !== "undefined" && Spirits && typeof Spirits.save === "function") Spirits.save(st); } catch (e) { /* 配额炸了也不许抛 */ }
  }

  // FNV-1a 32 位哈希 → 0/1/2（三个变体都被占时才用；同一只沁灵恒定）。
  function hashMod3(s) {
    var h = 0x811c9dc5, str = String(s == null ? "" : s);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 3;
  }

  // 当前羁绊档（Spirits 在就用它的口径，不在就用 rec 上的字段，都没有给 0）。
  function bondLvOf(rec) {
    try {
      if (typeof Spirits !== "undefined" && Spirits && typeof Spirits.bondLevel === "function") {
        var v = Number((Spirits.bondLevel(Number((rec || {}).bond) || 0) || {}).lv);
        if (isFinite(v) && v > 0) return v;
      }
    } catch (e) { /* falls through */ }
    var n = Number((rec || {}).loveBondLv || (rec || {}).bondLv);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // 距某个日期过了几天；日期缺失 / 非法 ⇒ -1（⇒ 冷却判定一律 false，⛔ 不偷偷放行）。
  function daysSince(d) {
    var s = String(d == null ? "" : d).trim();
    if (!s) return -1;
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      var t0 = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      var n0 = new Date();
      var t1 = Date.UTC(n0.getFullYear(), n0.getMonth(), n0.getDate());
      return Math.round((t1 - t0) / 86400000);
    }
    var ts = Number(s);
    if (isFinite(ts) && ts > 0) {
      var n1 = new Date();
      return Math.round((Date.UTC(n1.getFullYear(), n1.getMonth(), n1.getDate()) - Date.UTC(1970, 0, 1)) / 86400000 - Math.floor(ts / 86400000));
    }
    return -1;
  }

  /* ======================= 变体分配 ======================= */
  /* 同人格型的多只沁灵，告白语尽量不重样；同一只每次告白是同一句（不闪变）。
     算法：O(n) 单遍扫 store，收集「同型里已被占用的变体」，取第一个空位 0→1→2；
          三个都占满 ⇒ hash(spiritId) % 3（⛔ 禁止两两枚举，n 只全同型也只有一趟）。 */
  function variantFor(store, rec, persId) {
    var r = rec || {};
    var v = Number(r.loveVariant);
    if (v === 0 || v === 1 || v === 2) return v;          // ① 已定 ⇒ 直接返回（稳定，不闪变）

    var want = persId || persKeyOf(r);
    var st = null;
    try { st = storeOf(store); } catch (e) { st = {}; }
    var used = {}, selfKey = "";
    try {
      Object.keys(st || {}).forEach(function (k) {         // ② 单遍扫：收集同型已占变体 + 找到自己的 key
        var o = st[k];
        if (!o || typeof o !== "object") return;
        if (o === r) { selfKey = String(k); return; }
        if (persKeyOf(o) !== want) return;
        var ov = Number(o.loveVariant);
        if (ov === 0 || ov === 1 || ov === 2) used[ov] = 1;
      });
    } catch (e) { /* store 结构异常 ⇒ 视作全空 */ }

    var pick = -1;
    for (var i = 0; i < 3; i++) { if (!used[i]) { pick = i; break; } }   // ③ 第一个未被占用的
    if (pick < 0) pick = hashMod3(selfKey || (r.id != null ? r.id : (r.itemId != null ? r.itemId : "")));
    pick = ((pick % 3) + 3) % 3;

    try { r.loveVariant = pick; } catch (e) { /* 只读 rec ⇒ 至少本次返回值是对的 */ }   // ④ 写回
    try { saveStore(store, st); } catch (e) { /* 持久化失败不影响本轮 */ }
    return pick;
  }

  /* ======================= 称呼 ======================= */
  // {call} 的来源：Spirits.callFor(rec)（回落链 lovecall → 昵称 → 你 → 主人）。
  // ⚠️ Spirits 在 love.js 之前还是之后加载不确定 ⇒ 必须容错：拿不到就回落「主人」。
  function callOf(rec) {
    try {
      if (typeof Spirits !== "undefined" && Spirits && typeof Spirits.callFor === "function") {
        var c = Spirits.callFor(rec);
        if (c) return String(c);
      }
    } catch (e) { /* 走回落 */ }
    return "主人";
  }
  // {ta}/{call} 两个占位符一次扫完替换（⛔ 两步 replace 会让 taName 里带 {call} 时被二次吃掉）。
  function fillAll(s, rec, taName) {
    var t = String(s == null ? "" : s);
    var call = callOf(rec);
    var ta = (taName == null || String(taName) === "") ? "那只" : String(taName);
    return t.replace(/\{(ta|call)\}/g, function (m, k) { return k === "ta" ? ta : call; });
  }

  /* ======================= 文案取用 ======================= */
  /* scriptFor(rec, item[, store]) —— 一次给全「这台戏的所有台词」。
     round = rec.loveTries >= 1 ? 2 : 1（0 次婉拒=首告；婉拒过=再告）。
     declined：round=1 用「首次婉拒」，round=2 用「二次婉拒」。⛔ 六项绝不为空串。 */
  function scriptFor(rec, item, store) {
    var r = rec || {};
    var pers = persKeyOf(r);
    var t = resolveType(pers);
    var tries = 0;
    try { tries = Math.max(0, Number(r.loveTries) || 0); } catch (e) { tries = 0; }
    var round = tries >= 1 ? 2 : 1;
    var v = variantFor(store, r, pers);

    var rounds = LOVE_B[t] || LOVE_B[FALLBACK_TYPE];
    var arr = (rounds && rounds[round - 1]) || (rounds && rounds[0]) || [];
    var confess = String(arr[v] || arr[0] || (LOVE_B[FALLBACK_TYPE][round - 1] || [])[0] || "");
    var declinedSet = LOVE_E[t] || LOVE_E[FALLBACK_TYPE];
    var declined = String((round === 2 ? declinedSet[1] : declinedSet[0]) || declinedSet[0] || "");

    return {
      hint: String(LOVE_A[t] || LOVE_A[FALLBACK_TYPE] || ""),
      confess: confess,
      callAsk: String(LOVE_C[t] || LOVE_C[FALLBACK_TYPE] || ""),
      accepted: String(LOVE_D[t] || LOVE_D[FALLBACK_TYPE] || ""),
      declined: declined,
      round: round,
      variant: v,
      type: t,          // 落回的型（调试用）
      pers: pers,       // 原始 look.pers（调试用）
    };
  }

  /* ======================= 二次告白契机 ======================= */
  /* canReConfess(rec, item) —— 只有「婉拒过」才谈再告，三关全过才 true：
       ① 冷却：距 rec.loveDeclinedAt 已过 >= 7 天（无日期字段 ⇒ false）
       ② 次数：rec.loveTries < 2（最多主动告白 2 次）
       ③ 契机：羁绊档比上次告白时升了一档（对比 rec.loveBondLvAt） OR 释放过善意（rec.loveKindled）
     🔴 善意钩子待接：送礼 / 照料 成功后由调用方置 rec.loveKindled = true；本轮没人写，读不到就当 false，
        ⇒ 当前只有「羁绊升档」这一条路径能放行。 */
  function canReConfess(rec, item) {
    var r = rec || {};
    if (String(r.loveState || "none") !== "declined") return false;      // 前置：只认婉拒态
    var tries = Math.max(0, Number(r.loveTries) || 0);
    if (tries >= RECONFESS_CFG.MAX_TRIES) return false;                    // ② 次数
    var d = daysSince(r.loveDeclinedAt);
    if (!(d >= RECONFESS_CFG.COOLDOWN_DAYS)) return false;                 // ① 冷却（含「无日期 ⇒ -1 ⇒ false」）
    if (!RECONFESS_CFG.NEED_BOND_UP) return true;
    var lv = bondLvOf(r);
    var lvAt = Number(r.loveBondLvAt);
    var bondUp = isFinite(lvAt) && lvAt >= 0 && lv > lvAt;                 // ③-a 羁绊升档
    var kindled = (r.loveKindled === true);                                // ③-b 善意标记
    return bondUp || kindled;
  }

  /* ======================= 统计 ======================= */
  function libStats() {
    var b = 0, e = 0, acd = 0;
    LOVE_TYPES.forEach(function (t) {
      b += (LOVE_B[t] || []).reduce(function (n, r) { return n + (r ? r.length : 0); }, 0);
      e += (LOVE_E[t] || []).length;
      acd += (LOVE_A[t] ? 1 : 0) + (LOVE_C[t] ? 1 : 0) + (LOVE_D[t] ? 1 : 0);
    });
    return { types: LOVE_TYPES.length, b: b, e: e, acd: acd };
  }

  /* ======================= 导出 ======================= */
  var Love = {
    // 🔴 对外契约（与 js/app.js v177d 容错调用严格对齐，签名不许改）
    scriptFor: scriptFor,
    canReConfess: canReConfess,
    RECONFESS_CFG: RECONFESS_CFG,
    RETRY_COOLDOWN_DAYS: RETRY_COOLDOWN_DAYS,
    fillAll: fillAll,
    libStats: libStats,
    // 内部表 + 工具（导出只为自测 / 调试面板，UI 层⛔ 不许绕过 scriptFor 直读表）
    LOVE_TYPES: LOVE_TYPES, LOVE_TYPE_ZH: LOVE_TYPE_ZH, FALLBACK_TYPE: FALLBACK_TYPE, NO_PERS: NO_PERS,
    LOVE_B: LOVE_B, LOVE_E: LOVE_E, LOVE_A: LOVE_A, LOVE_C: LOVE_C, LOVE_D: LOVE_D,
    variantFor: variantFor, persKeyOf: persKeyOf, resolveType: resolveType,
    callOf: callOf, bondLvOf: bondLvOf, daysSince: daysSince,
  };
  if (typeof window !== "undefined") window.Love = Love;
  if (typeof module !== "undefined" && module.exports) module.exports = Love;
  try { if (typeof globalThis !== "undefined") globalThis.Love = Love; } catch (e) { /* 老环境 */ }
})();

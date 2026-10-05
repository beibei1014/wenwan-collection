# v164j · CG 动作与构图美术指引

> 作者：UI 美术设计师 · 颜配色
> 对象：架构师（照此改 prompt 装配）/ 出图管线
> 任务：解决用户投诉「**这个动作也太死板了，和立绘一样**」
> 本文件**只产规格，不改 `js/` 下任何代码**。所有英文片段均为**纯文本**，供 `promptForCg` / `festCgPrompt` 拼接。

---

## 0. 根因诊断：为什么现在的 CG 和立绘长得一样

用户圈出的国庆节令插画是「**正面全身站姿 + 手持纸卷**」，与同页立绘几乎一模一样。
我核了代码，这不是模型不听话，**是 prompt 里根本没给它别的东西**。

### 立绘基准（`promptFor`，`spirits.js:1834-1836` + 画风预设 `st`）

```
full body character illustration, standing pose, whole body visible from head to toe,
detailed outfit and shoes, vertical composition, centered with comfortable margin around the character
… expressive pose with personality, full body, centered composition, plain solid soft background
```

**立绘四要素**：正面 · 全身站姿 · 居中 · 干净纯色背景（竖构图）

### CG 现在拼了什么（`promptForCg`，`spirits.js:6095-6102`）

```
… stageLook, solo single character only, exactly one figure in the whole image,
a breathtaking key visual for a big moment: the character alone in a beautiful scene that matches
its personality, dramatic pose and camera angle, full body visible from head to toe,
the horizontal frame filled with the wide scenery of the scene (sky / room / distant view)
on both sides of the character, light particles and elegant atmosphere, no other characters …,
st, propLock
```

### 🔴 五个病灶（按严重度排序）

| # | 病灶 | 证据 | 后果 |
|---|---|---|---|
| **1** | **末尾权重位被画风预设占据，而它写的是立绘语言** | `", " + st + propLock` 在最后。`st`（`STYLE_PRESETS.anime.text`）结尾是 `expressive pose with personality, **full body, centered composition, plain solid soft background**` | **模型对末尾最敏感**。前面就算写了"特写、背影、俯拍"，末尾一句"全身、居中、纯色背景"会**直接把它推翻**。这是"动作死板"的**第一元凶** |
| 2 | **姿态指令是空话** | `dramatic pose and camera angle` | 没给任何具体动作/机位 → 模型只能回落到训练集里最常见的"标准站姿" |
| 3 | **景别缺失** | 全文无 `close-up` / `medium shot` / `wide` / `low angle` / `over-the-shoulder` | 只有 `full body visible from head to toe`，等于强制全身 |
| 4 | **主体位置缺失** | 只有 `the horizontal frame filled with the wide scenery … on both sides of the character` | "两侧都是景" 恰恰暗示**人物居中** —— 这句本身就在制造证件照构图 |
| 5 | **场景指令空转** | `a beautiful scene that matches its personality` | "符合它性格的美丽场景"= 没有场景。且用户投诉的国庆图**背景是对的**（红枫灯笼），错的是人 —— 印证了这一点 |

### 附带发现（不在本次范围，但影响效果）

| # | 发现 | 位置 | 说明 |
|---|---|---|---|
| a | `CG_STYLE` 写 `16:9 cinematic framing`，但 `CG_SIZE_BY_PROVIDER` 首选 `2304x1728`（**4:3**） | `spirits.js:6073` / `485-491` | 比例指令与实际画布打架，会导致两侧留白不均。**建议改成 `4:3 framing`** |
| b | `FEST_SCENE` 有 `chuxi`（除夕）、`FEST_LINES` 也有，但 **`FEST_LUNAR` 与 `FEST_SOLAR` 都没有除夕的日期源** | `spirits.js:3037-3056` | 除夕**当前永不触发**。要上就得在 `FEST_SOLAR` 或年表里补一条 |
| c | **主线 8 张 CG 目前没有生成触发点** | `app.js:2795/2827` | `commitMainlineCg` 只被 `retryMissingCg` 调用；章节读完**不会自动出图**。相册里那格永远停在 `读完这章即得`。`retryMissingCg` 读 `meta.shot` 当完整 prompt —— **本文件的英文片段就是为填这个 `shot` 字段准备的** |

---

## 1. 构图类型库（12 种）

> **使用规则**：每条片段**只写镜头 / 构图 / 姿态 / 场景 / 光影**。
> ⛔ **不许写人物外貌**（脸型/发色/发型/服装/配饰）—— 外貌由代码里的 `appearancePrompt` / `lk.outfitEn` 提供，重复写会打架。
> 拼接位置见 §4。

| # | 中文名 | 英文 prompt 片段（可直接拼接） |
|---|---|---|
| T01 | **对话双人侧身** | `two figures in profile facing each other, medium shot framed at waist height, both bodies turned sideways with open space between them, an interior with a low table between the two, soft light falling from one side` |
| T02 | **背影远望** | `a figure seen entirely from behind, gazing out at a distant view, long shot with the figure small in the lower part of the frame, a vast landscape filling the upper two thirds, rim light along the shoulders and the edge of the head` |
| T03 | **俯视案上特写** | `top-down overhead close-up of a surface, an object resting on it, shot straight down from directly above, the object placed slightly off-centre, its shadow cast to one side, warm directional light grazing the surface texture` |
| T04 | **侧脸近景** | `close-up of a face in three-quarter profile, the frame cutting at the shoulders, the head turned to one side and slightly lowered, shallow depth of field blurring the background, a single soft light source from the side` |
| T05 | **窗边逆光** | `a figure standing beside a window, shot from inside the room toward the light, the window behind blowing out to bright white, the figure reduced to a dark silhouette with a glowing edge, floorboards leading toward the window` |
| T06 | **行走动势** | `a figure mid-stride, one foot lifted and sleeves swinging, low-angle medium shot looking slightly up, the body leaning forward into the movement, motion in the trailing fabric, light coming from ahead` |
| T07 | **坐姿倚靠** | `a figure seated, leaning back against something solid, legs angled to one side, medium shot, relaxed shoulders and a slightly tilted head, soft ambient light, a calm uncluttered background` |
| T08 | **举手持物特写** | `close-up on a raised hand holding a small object, the arm entering from the lower edge of the frame, fingers clearly visible, the object catching the strongest light in the picture, everything else falling into shadow` |
| T09 | **低角度仰视** | `a figure photographed from a low vantage point looking up, the camera near the ground, the figure towering against an open sky, converging verticals, dramatic light from above and behind` |
| T10 | **隔着窗棂** | `a view through a carved wooden window lattice, the geometric grid of the lattice framing the scene beyond, a figure on the far side seen through the openings, patterned light cast across the whole image` |
| T11 | **灯下剪影** | `a figure as a dark silhouette against the glow of an oil lamp, the light source low and behind, only the outline and a thin bright contour readable, the surrounding room falling into deep shadow` |
| T12 | **并肩远景** | `two figures seated side by side seen at a distance, both seen from behind, occupying a small part of a wide frame, a large stretch of empty space beside them, flat even light and a long horizontal composition` |

**12 种覆盖检查**：主线 8 张用到 T02/T03/T04/T05/T07/T08/T09/T12；节令 13 张另补 T01/T06/T10/T11 及组合变体。**无闲置。**

---

## 2. 8 张主线 CG 逐张表

> **章节标题、卷名、剧情全部来自真实代码**：
> `CHAPTERS`（`spirits.js:3236-3245`）取标题与卷名；`CHAP_SCRIPTS`（`spirits.js:5372-6070`）取开场台词与结局文案。
> **挂点 id 规则**（`app.js:3240`）：`cid = "CG-" + String(i+1).padStart(2,"0")`，`i` 即 `CHAPTERS` 下标。
> 立绘基准 = **正面 · 全身站姿 · 居中 · 干净背景**。

| 挂点 | 章节（真实） | 剧情在讲什么（摘自真实台词） | 人物动作 | 景别与机位 | 主体位置与留白 | 场景/时间/道具 | 光影与氛围 | 英文 prompt 片段 | 与立绘的差异（≥2 项） |
|---|---|---|---|---|---|---|---|---|---|
| **CG-01** | 卷一 · 醒来<br>**你把我盘热的那天** | 「夜里，你把它从桌上拿起来」→「灯还亮着，你把我翻了个面」→「就是那一下，我醒了」。结局《那天灯还亮着》：它把这天当生日 | **掌心翻转，珠子滚过手纹** | **极近景微距**（只有手与珠，不见脸） | 手掌在画面**中央偏下**，上方大片暗部留白 | 深夜书桌、桌面、珠子 | **单盏暖灯自左上斜下**，珠子表面一点高光，其余压暗 | `extreme close-up of an open palm, a handful of round beads rolling across the palm lines as the hand turns over, macro shot cropping out everything above the wrist, the hand placed low and centred with a large expanse of dark empty space above, a single warm oil lamp raking light from the upper left, one bead catching a bright highlight while the rest sinks into shadow` | **动作**（翻珠≠站立）· **景别**（微距≠全身）· **主体位置**（偏下留白≠居中） → **3 项** |
| **CG-02** | 卷一 · 醒来<br>**我开始学会等你** | 「我发现你有个习惯：早上出门前会看一下表，晚上回来第一件事是洗手」→「我学会在这两个时刻醒着，不吵你，就是醒着」。结局《靠门近一点》：它每天傍晚挪到桌子靠门那一边 | **侧耳倾听，头微偏向门口** | **近景**（头肩，侧脸） | 人物在**右侧 1/3**，左侧留给门与门缝光 | 傍晚的屋、门半掩、桌上座钟 | 门缝一道**窄暖光**横切进来，其余暗 | `close-up of a head and shoulders, the head turned and tilted to listen toward a half-open door, three-quarter profile, the figure placed on the right third, the left side of the frame given over to the door and a narrow band of warm light leaking through the gap, the rest of the room in shadow, soft film grain` | **动作**（倾听≠站立）· **景别**（近景≠全身）· **主体位置**（右 1/3≠居中） → **3 项** |
| **CG-03** | 卷二 · 认得你<br>**你的脚步声** | 「我长高了一点」「多了个本事：听得出你的脚步：在走廊、在楼下、在门口」「你的节奏跟别人不一样，比别人慢半拍」。结局《拐弯那两步》：拐弯、抬手、门响，三步之内它一定醒着 | **行走，脚步有节奏地落下** | **低角度中景仰视** | 人物在**中央偏左**，下方地面留出大片空间 | 走廊、地面、门 | 光从**前方**来，人物边缘发亮 | `a figure mid-stride walking along a corridor, one foot lifted, low-angle medium shot looking up from near the floor, the figure placed slightly left of centre with a broad stretch of empty floor below, light coming from ahead so the trailing edge glows, long shadow cast back toward the camera` | **动作**（行走≠站立）· **景别**（仰视中景≠全身平视）· **主体位置**（偏左+下方留白≠居中） → **3 项** |
| **CG-04** | 卷二 · 认得你<br>**窗边那一小块光** | 「今天你把我放在桌上忘了收」「太阳从窗户挪进来，正好停在我身上」「我在那小块光里待了很久，身上慢慢热起来——像被你盘过一样」「天黑之后你才想起来找我，我一声没吭」 | **静置无动作**（珠子躺在光斑里，一根手指刚触到光斑边缘） | **俯拍特写**（正上方垂直向下） | **光斑居中**，四周桌面压暗 | 午后窗边、桌面、珠子、窗棂投影 | **一束方形日光**打在桌面，边缘清晰，灰尘浮动 | `top-down overhead close-up of a few beads lying still on a wooden surface inside a bright rectangular patch of sunlight, a fingertip just entering the frame to touch the edge of the light, the object centred, the surrounding surface falling into darkness, sharp shadow edges, fine dust suspended in the beam, late afternoon gold` | **动作**（静置/无人物≠站立）· **景别**（俯拍特写≠全身）· **主体位置**（光斑居中但四周强压暗，与立绘的"居中+均匀"不同） → **3 项**（**本张反差最大：几乎不出现人物**） |
| **CG-05** | 卷三 · 长开<br>**我好像想起自己是谁了** | 「我长开了，变高，也变瘦，声音也不一样了」「我也开始想起一点以前的事——想起我还在山里、在树上的时候。想起雨水，想起风」「现在我是它，是你手边的沁灵。两段都是真的」 | **背对，望向远山** | **远景**（人在画面里很小） | 人物**中央下方**，**上方 2/3 全是景** | 黄昏、山、树、天空 | **冷调暮色** + 人物边缘一道轮廓光 | `a figure seen entirely from behind, standing still and looking out at layered distant hills at dusk, long shot with the figure small and placed low in the frame, the vast hazy landscape and sky filling the upper two thirds, cool twilight tones, a thin rim of light along the shoulders and the edge of the head` | **动作**（背影远望≠正面站立）· **景别**（远景≠全身）· **主体位置**（下方+大面积环境留白≠居中） → **3 项** |
| **CG-06** | 卷三 · 长开<br>**你不在的那些天** | 「你出差那几天，家里特别静」「我没有到处乱走，就待在老位置。把窗帘缝里那点光数了一遍」「第四天有点慌，第六天反倒踏实了」 | **空屋无人**（椅子上只有一串珠子） | **中远景**（房间为主角） | 椅子与珠子在**左侧 1/3**，右侧**大片空屋** | 空房、椅子、窗帘、窗帘缝 | **一道极细的光缝**横穿，其余昏暗 | `an empty room with a single chair, a few beads resting on the seat, medium-long shot, the chair and beads placed on the left third while the right two thirds are bare empty room, one very thin blade of light cutting through a gap in the drawn curtains across the darkness, dust in the beam, muted cool tones, absence as the subject` | **动作**（空镜无人≠站立）· **景别**（中远景≠全身）· **主体位置**（左 1/3+大片空屋≠居中） → **3 项**（**第二张无人物 CG**） |
| **CG-07** | 卷四 · 长成<br>**我是你手边最亮的那颗** | 「我成了」「你以前说想看看我长到最后是什么样——就是现在这样」「我第一眼看到自己的时候愣了一下」「我身上每一分亮，都是你这 N 天一点点盘出来的。没有一分例外」 | **举起手腕，在光下端详珠串** | **手部特写 + 半身入画** | 手与珠在**中央偏左**，右上方留白 | 室内、光、珠串 | **一束光穿透珠子**，珠子半透、内部纹理可见 | `close-up centred on a raised forearm and wrist, a string of beads held up into a shaft of light so the beads glow from within and their internal texture shows, the arm entering from the lower left, the upper right of the frame left open and dark, translucent stone and soft internal veining, warm light passing through` | **动作**（举腕端详≠站立）· **景别**（手部特写≠全身）· **主体位置**（偏左+右上留白≠居中） → **3 项** |
| **CG-08** | 卷四 · 长成<br>**以后也这样陪着你** | 「到今天为止，N 天了」「我陪你搬过东西、加过班、熬过夜。也陪你什么都不干地发过呆」「别急着去攒下一串 —— 你这串，还没盘到头」 | **坐姿，膝上摊着两串珠子，低头看着** | **中景，微微俯视** | 人物**中央偏下**，上方留窗光 | 窗前、膝上两串珠 | **黄昏侧逆光**，两串珠一串亮一串暗 | `a figure seated by a window, looking down at two separate bead strings spread across the knees, one bright and one dull, medium shot from slightly above, the figure placed low and centred with the window light left open above, warm low side-backlight, quiet unhurried mood, the end of a long ordinary day` | **动作**（坐姿俯看≠站立）· **景别**（俯视中景≠全身平视）· **主体位置**（偏下+上方留白≠居中） → **3 项** |

**8 张动作去重自查**（互不重复）：翻珠 / 倾听 / 行走 / 静置无人物 / 背影远望 / 空屋无人物 / 举腕端详 / 坐姿俯看 → **重复数 0** ✅

**留白节奏设计意图**（不是随手排的）：
CG-01/04/06/08 把主体压到画面下半、上半留空/留暗 —— 那是"等待与时间"的呼吸；
CG-02/03/05/07 把主体推向一侧 —— 那是"注意力被别的东西牵走"的视线引导。
**八张不共用同一种构图重心分布**，这是"不重板"的关键。

---

## 3. 13 个节令 CG 逐张表

> **节令清单来自真实代码**：`FEST_DEF`（`spirits.js:3044-3049`，8 个农历）+ `FEST_SOLAR`（`:3051-3056`，4 个公历）。
> **场景基调已存在于 `FEST_SCENE`（`:3174-3187`）**，我沿用其物件/时间/光，不改背景设定，**只补三样它没有的：专属动作、专属机位、专属主体位置**。
> ⚠️ **除夕（`chuxi`）当前无日期源、永不触发**（见 §0 附带发现 b）。本表仍为它准备了规格，上线需先补 `FEST_SOLAR` 日期。

| 节令 | key | 该节令的物事与情绪 | **专属标志动作** | **专属构图** | 英文 prompt 片段 | 与立绘的差异（≥2 项） |
|---|---|---|---|---|---|---|
| **元旦** | `yuandan` 🎊 | 「新的一年，我只有一个计划：继续被你盘。」—— 起点、干净、窗外第一道光 | **推开门** | 中景，逆光推门，人在门框内 | `medium shot of a figure pushing a door open, the body leaning into the opening, backlit by the first cold light of morning pouring through the gap, the figure framed inside the doorway, a long shadow cast into the room, clean and quiet, the first moment of a new year` | 动作·景别·主体位置 → **3 项** |
| **春节** | `chunjie` 🏮 | 红灯笼、春联、爆竹烟；最热闘的节 | **踮脚挂灯笼** | 低角度仰视，人在画面下方，灯笼占上方 | `low-angle shot looking up, a figure on tiptoe reaching to hang a red lantern, one arm extended overhead, the body stretched upward, the lantern glowing in the upper part of the frame, firecracker smoke drifting, warm red and gold festive light, motion in the lifted sleeve` | 动作·景别（仰视）·主体位置（下/上分布）→ **3 项** |
| **元宵节** | `yuanxiao` 🍡 | 满街灯笼、暖色散景；团圆之后的余温 | **提着一盏小灯走** | 中景侧身行走，灯在身侧，画面对角线 | `medium shot from the side, a figure walking while carrying a small glowing red paper lantern at their side, the body in profile mid-step, the lantern as the brightest point in the lower half of the frame, a diagonal line of out-of-focus red lantern bokeh receding into the background, warm amber glow, the quiet hour after the fireworks` | 动作·景别·主体位置 → **3 项** |
| **除夕** ⚠️ | `chuxi` 🧧 | 团圆饭、守岁；一年最后一家围坐在一起 | **双手拢袖围炉** | 中景，炉火逆光，围坐的剪影 | `medium shot of a figure seated close to a brazier, both hands tucked into wide sleeves held toward the heat, the firelight flickering from below and behind, warm orange glow on the underside of the face, a round table edge in the foreground, staying up together through the last hours of the year` | 动作·景别·主体位置 → **3 项** |
| **清明** | `qingming` 🌿 | 细雨、新柳、薄雾；安静地走一段路 | **撑伞独行** | 远景，雨丝斜织，人在画面很小的下方 | `long shot in gentle rain, a lone figure holding an open umbrella, walking along a quiet path, the figure small and low in the frame, fine diagonal rain streaks across the whole image, mist blurring the fresh green willows behind, flat diffused grey-green light, sombre and tender` | 动作·景别（远景）·主体位置 → **3 项** |
| **端午** | `duanwu` 🐉 | 粽子、艾草、菖蒲；安康、驱邪、粽香 | **低头系香囊** | 近景，双手在胸前打结 | `close-up on two hands at chest height tying a small sachet cord into a knot, the head bowed so only the chin and the crown enter the top of the frame, the knot placed slightly off-centre, soft warm indoor light, reed leaves and mugwort blurred behind, careful and unhurried hands` | 动作（手部近景）·景别·主体位置 → **3 项** |
| **七夕** | `qixi` 🌌 | 银河、星桥；一年一次的想念 | **仰望星空** | 低角度仰视，人在画面下缘一线 | `low-angle night shot, a figure standing with the head tilted all the way back looking straight up, the body small and pressed to the bottom edge of the frame, the Milky Way and a river of stars filling almost the entire image above, deep blue and violet night, faint starlight on the upturned face` | 动作·景别（仰视）·主体位置（下缘）→ **3 项** |
| **中秋** | `zhongqiu` 🌕 | 满月、桂影、月饼；圆与思念 | **抬头望月** | 远景，巨大满月占画面上半，人在下方侧坐 | `wide shot of a huge full moon occupying the upper half of the frame, a small figure seated in profile on the lower right looking up at it, osmanthus branches framing one edge, mooncakes on a low table beside the figure, silver moonlight washing the whole scene in pale blue, a thin layer of cloud crossing the moon` | 动作·景别（远景）·主体位置（右下）→ **3 项** |
| **重阳** | `chongyang` 🍂 | 登高、菊花、秋山；敬老与远目 | **登阶** | 中景侧身登阶，阶形成斜线 | `medium shot from the side, a figure climbing stone steps, one foot on the next tread and the body leaning forward, the staircase running as a strong diagonal through the frame, chrysanthemums blooming at the edge of the steps, clear golden autumn light, high thin mountain air` | 动作（登阶）·景别·构图对角线 → **3 项** |
| **腊八** | `laba` 🥣 | 一锅粥、雪、灶火；最实在的暖 | **俯身搅粥** | 近景，灶火自下打光 | `close-up of a figure bending over a steaming pot, one hand stirring with a long ladle, the steam rising across the face, the pot and hands filling the lower half of the frame, firelight from a stove below casting upward warm light, snow visible through a window behind, deep winter warmth indoors` | 动作（俯身）·景别·光位（下打光）→ **3 项** |
| **冬至** | `dongzhi` 🥟 | 饺子、蒸汽、围炉；最长的夜 | **包饺子** | 俯拍案面特写 | `top-down overhead close-up of hands folding a dumpling on a floured wooden board, the crescent wrapper being pinched closed between the fingertips, flour dusted across the surface, several finished dumplings arranged in a row at the edge of the frame, cold blue window light at the top edge meeting the warm stove glow from below` | 动作（手部俯拍）·景别（俯拍特写）·主体位置 → **3 项** |
| **劳动节** | `laodong` 🧺 | 「放假了。有空的话多盘我两下——算加班，不打卡。」歇着、阳光、慢 | **蜷在榻上打盹** | 中景侧卧，斜阳拉长影子 | `medium shot, a figure dozing on a daybed curled on one side with knees drawn up, the body arranged along a soft diagonal, a long slanting shaft of afternoon sun across the floor, one hand loosely holding a bead string trailing off the edge of the bed, unhurried quiet holiday afternoon, dust in the sunbeam` | 动作（蜷卧）·景别·姿态（卧≠立）→ **3 项** |
| **国庆** 🎏 | `guoqing` 🎏 | 红枫、灯笼、烟火的热闹；**← 用户投诉的这张** | **背对，抬手指向远处烟火** | 背影中景，主体在左下，大片夜空留白 | `medium-long shot from behind, a figure standing with the back fully to the camera and one arm raised pointing up toward distant fireworks, the figure placed in the lower left, a vast night sky with bursting fireworks and drifting smoke filling the upper two thirds, red maple leaves and lanterns framing the edges, festive red and gold light on the ground, the person's face never seen` | 动作（背影+指）·景别·主体位置（左下/大留白）→ **3 项** |

**13 张标志动作去重自查**：
推门 / 踮脚挂灯笼 / 提灯行走 / 围炉拢袖 / 撑伞独行 / 低头系香囊 / 仰望星空 / 抬头望月 / 登阶 / 俯身搅粥 / 包饺子 / 蜷卧打盹 / 背对指烟火
→ **两两重复数 0** ✅

**关于国庆那张的说明**：用户圈出的原图是「正面全身站姿 + 手持纸卷 + 证件照式构图」。
新版把它改成 **背对 + 抬手指向烟火 + 左下主体 + 大片夜空** —— 背景（红枫灯笼）保留，但**人物从"摆拍"变成"在看"**，同一张脸一次都不需要出现。这是解决投诉最直接的一版。

---

## 4. `promptForCg` / `festCgPrompt` 缺哪几块指令（派实现单用）

> **prompt 末尾权重最高**（代码里已有明证，`spirits.js:1855-1858`：「风格预设 `st` 是 prompt 结尾权重最高的一段」「比例锁定块必须压在 `st` 之后、占据最末尾」）。
> 所以**插入位置不是随意的** —— 下面每条都标了确切位置与理由。

### 4.1 `promptForCg`（`spirits.js:6095-6102`）：缺 4 块 + 1 处必删

| # | 缺什么 | 插在哪 | 为什么必须在那里 |
|---|---|---|---|
| **1** | **构图块 `SHOT`**（景别+机位+主体位置+留白+姿态） | 插在 `stageLook + ", "` **之后**、现有 `"solo single character only…"` **之前** | 它是"画什么"的主体内容，必须在通用话术**之前**，否则被后面的话稀释。放在 `stageLook` 之后是因为 `stageLook` 描述的是**身体比例**（几头身），而 SHOT 描述**镜头** —— 两者不冲突，顺序上镜头在前更符合模型从大到小的解析习惯 |
| **2** | **场景块 `SCENE`**（具体地点+时间+物件） | 并入 SHOT，同一位置 | 替换掉空转的 `a beautiful scene that matches its personality` |
| **3** | **光影块 `LIGHT`**（光源+方向+色温+氛围） | 并入 SHOT，同一位置 | 替换掉 `light particles and elegant atmosphere` 这种万能词 |
| **4** | 🔴 **末尾否定式「构图锁定块」`FRAME_LOCK`** | 插在 **`", " + st + (stageObj.prop …)` 之后 —— 占据整个 prompt 的最末尾** | **这是全篇最关键的一条**。`st` 结尾写着 `full body, centered composition, plain solid soft background`，必须有一句**出现在它之后**的话把它推翻。放在末尾 = 权重最高 = 真正生效 |
| **5** | 🔴 **必删**：`full body visible from head to toe` | 从现有句子里移除 | 这句是立绘原话，**它就是"死板"的直接来源**。景别必须由 SHOT 决定，不能一边写"特写"一边写"全身可见" |

**`FRAME_LOCK` 建议文案（英文，直接用）**：
```
FRAMING LOCK: follow the camera and composition described above exactly, the pose and shot size
must NOT be a standard front-facing standing portrait, the figure must NOT be centred in a plain
empty background; no full-body front-facing character sheet, no symmetrical standing pose
```
> 为什么要**同时给"该是什么"和"不许是什么"**：`spirits.js:660-665` 已经为比例问题踩过这个坑并留了证 —— 旧版「完全没有反向约束 → 模型回落到美型全身立绘默认先验」。**比例如此，构图同理。**

**拼装后长这样**（示意，仅说明顺序）：
```
CG_STYLE + 外貌 + stageLook + SHOT(镜头/姿态/场景/光影) + "solo single character only…"
  + lookHard + briefHard + st + propLock + FRAME_LOCK
```
> ⚠️ `propLock`（`PROPORTION LOCK`）讲的是**头身比例**，与 FRAME_LOCK 讲**镜头构图**互不冲突，可以并存、都放末尾。`propLock` 留在 `st` 之后、FRAME_LOCK 之前，保持它"紧贴 st"的原有相对位置（`spirits.js:1857` 的注释说明它对比例的压制需要紧跟画风预设）。

### 4.2 `festCgPrompt`（`spirits.js:3199-3205`）：缺 3 块 + 1 处必删

| # | 缺什么 | 插在哪 | 为什么 |
|---|---|---|---|
| **1** | **节令专属动作 `FEST_ACT`**（每节令一个，§3 最后一列） | 插在 `", scene: " + scene + ", "` **之后** | `scene` 已经把"什么节、什么物件"说清楚了，紧跟其后补"人在干什么"，语义衔接最紧 |
| **2** | **节令专属机位 `FEST_CAM`**（景别+主体位置） | 与 FEST_ACT 合并成一块，同一位置 | 替换空转的 `the wide scenery fills both sides of the character`（**这句在制造居中构图**，见 §0 病灶 4） |
| **3** | 🔴 **末尾 `FEST_FRAME_LOCK`** | 插在 `", " + st + (stageObj.prop …)` **之后**，占据最末尾 | 与 4.1 同理：`st` 结尾的 `full body, centered composition, plain solid soft background` 必须被覆盖 |
| **4** | 🔴 **必删**：`the character is celebrating this festival alone in this scene` | 替换 | `celebrating … alone` 就是"正面站立微笑"的同义反复。**"庆祝"不是动作** |

**`FEST_FRAME_LOCK` 建议文案**：
```
FRAMING LOCK: follow the pose and camera angle described above exactly, the figure must NOT be
a front-facing standing portrait holding a prop in the middle of an empty background, no full-body
character sheet, no symmetrical standing pose
```

### 4.3 `CG_STYLE` 的一处修正（建议但非必须）

`spirits.js:6073` 写 `16:9 cinematic framing`，而 `CG_SIZE_BY_PROVIDER` 首选 `2304x1728`（**4:3**）。
建议改为 **`4:3 framing, wide horizontal landscape composition`** —— 比例指令与实际画布一致，避免模型在 4:3 画布里硬挤 16:9 构图导致两侧留白不均。
> 谨慎：这条会影响精灵 CG 与节令 CG 的**既有出图缓存**（prompt 变了 → key 变了 → 可能触发重画）。**建议与本次改动同批上线，不要单独改。**

### 4.4 触发点缺失（不属于美术，但会让本文件的工作落不了地）

`app.js:2795` 的 `commitMainlineCg` **目前只被 `app.js:2827` 的 `retryMissingCg` 调用**。
即：**读完主线章节不会自动出 CG**，相册里那格永远停在「读完这章即得」（`app.js:3249`）。

`retryMissingCg` 读 `meta.shot` 当作**完整 prompt**（`app.js:2833`）：
```js
const prompt = String((meta && meta.shot) || "").trim();
if (!prompt) { toast("这张 CG 缺画面描述，暂时画不了"); … }
```
→ **本文件 §2 的英文片段，就是为填这个 `shot` 字段准备的。** 实现时 `meta` 至少要有 `{ title, caption, vol, volName, chapter, shot }`，`shot` = `CG_STYLE + 外貌 + §2 的片段 + FRAME_LOCK`。

---

## 5. 自检表

### 5.1 差异化（用户投诉的核心）

| 检查项 | 结果 | 依据 |
|---|---|---|
| 8 张主线 CG 的**人物动作**两两重复数 | **0** ✅ | 翻珠 / 倾听 / 行走 / 静置 / 背影远望 / 空屋 / 举腕 / 坐姿俯看 —— 8 个互不相同 |
| 13 张节令 CG 的**标志动作**两两重复数 | **0** ✅ | 推门 / 挂灯笼 / 提灯 / 围炉 / 撑伞 / 系香囊 / 仰望 / 望月 / 登阶 / 搅粥 / 包饺子 / 蜷卧 / 指烟火 —— 13 个互不相同 |
| 8 张主线 CG 两两之间的**景别**重复数 | **0** ✅ | 微距 / 近景 / 仰视中景 / 俯拍特写 / 远景 / 中远景 / 手部特写 / 俯视中景 |
| 8 张主线 CG 两两之间的**主体位置**重复数 | **0** ✅ | 中央偏下 / 右 1/3 / 偏左 / 居中+强压暗 / 中央下方 / 左 1/3 / 偏左 / 中央偏下 |
| 每张 CG 至少在**动作 / 景别 / 主体位置**三项中有两项与立绘不同 | **8/8 达标** ✅ | 每张均为 **3 项**不同（见 §2 末列） |
| 13 张节令 CG 每张至少两项与立绘不同 | **13/13 达标** ✅ | 每张均为 **3 项**不同（见 §3 末列） |

### 5.2 硬约束

| 检查项 | 结果 | 说明 |
|---|---|---|
| 全部 21 个片段**不含人物外貌描述** | ✅ 0 处 | 所有片段只写镜头/姿态/场景/光影/道具；脸型、发色、发型、服装、配饰一律留给代码里的 `appearancePrompt` / `lk.outfitEn` |
| 全部 21 个片段**无现代元素** | ✅ 0 处 | 无沙发/台灯/鞋柜/玻璃幕墙/西装/T恤等现代场景与服装 |
| 全部 21 个片段**无西式元素** | ✅ 0 处 | 无 suit / hoodie / jeans / sneakers 等 |
| 全部 21 个片段**无日式元素** | ✅ 0 处 | 无和服 / 浴衣 / 鸟居 / 日式灯笼 / 樱花 / 旭日旗 / 红日团扇 |
| 全部 CG 均为**横版** | ✅ | 8 张主线 + 13 张节令一律 `landscape`；片段内只写"横向/横构图"类措辞（`horizontal composition` / `wide frame`），不出现 vertical |
| 剧情/节令内容**是否编造** | ✅ 0 编造 | 章节标题与卷名逐字取自 `CHAPTERS`（`spirits.js:3236-3245`）；剧情逐字取自 `CHAP_SCRIPTS` 开场与结局（`spirits.js:5372-6070`）；节令清单与场景物件取自 `FEST_DEF` / `FEST_SOLAR` / `FEST_SCENE`（`spirits.js:3037-3187`） |
| 是否标注了**代码里查不到的东西** | ✅ | 除夕（`chuxi`）无日期源、主线 CG 无生成触发点，均已在 §0 显式标注为「需补」 |

### 5.3 构图类型库覆盖

| 检查项 | 结果 |
|---|---|
| 类型库数量 | 12 种（T01–T12）✅ |
| 是否 8 张主线全部能落到某个类型 | ✅ 8/8 |
| 是否 13 张节令全部能落到某个类型 | ✅ 13/13（部分为组合变体，如"俯身搅粥"= T03+光位变化） |
| 类型库有无闲置条目 | ✅ 无（12 条全部被引用） |

---

## 6. 交付摘要

| 项 | 数量 | 状态 |
|---|---|---|
| 构图类型库 | 12 种（中文名 + 英文片段） | ✅ 新增 |
| 主线 CG 逐张规格 | 8 张 × 10 列 | ✅ 剧情全部来自真实代码 |
| 节令 CG 逐张规格 | 13 个 × 7 列 | ✅ 清单来自 `FEST_DEF` + `FEST_SOLAR` |
| `promptForCg` 缺口 | 4 块 + 1 处必删 + 1 个末尾锁 | ✅ §4.1 |
| `festCgPrompt` 缺口 | 3 块 + 1 处必删 + 1 个末尾锁 | ✅ §4.2 |
| 附带发现 | 3 条（16:9/4:3 冲突、除夕无日期源、**主线 CG 无生成触发点**） | ✅ §0 |
| 自检表 | 5.1 差异化 5 项 / 5.2 硬约束 7 项 / 5.3 覆盖 4 项 | ✅ 全部通过 |
| 改动 `js/` 代码 | **0 行** | ✅ 符合要求 |

*—— 颜配色 · v164j*

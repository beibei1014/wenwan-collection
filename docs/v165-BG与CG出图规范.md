# v165 · BG 与 CG 出图规范

> 作者：UI 美术设计师 · 颜配色
> 对象：架构师（照此装配 prompt + 命名 seedKey）/ 出图管线（火山方舟 ark · 豆包 Seedream）
> 前情：`v164j-CG美术指引.md`（构图/末尾锁定块）· `v163-出图提炼规范.md`（古风一致位）· `v165-故事大纲.md` §八（BG 清单）+ 各章大纲表（CG 清单）
> **本文件只产规范，⛔ 不改 `js/` 下任何文件，不 commit。**

---

## 0. 范围与三条铁律

| # | 铁律 | 落实方式 |
|---|---|---|
| 1 | **中国古风统一调性** | 每条 prompt 都带古风前缀；负面位复用 `NEG_STYLE`（禁日式符号 / 禁西式现代服装 / 禁 V 字手势与坏笑 wink / 温和中性表情） |
| 2 | **⛔ 不写「密集恐惧 DENSITY LOCK」** | 画面按正常场景需要来画。**成排门灯（BG-11）、密点纹样（BG-19）都是明确要画的**，不刻意稀疏、不排等距人群。主理人 2026-10-03 已删除该硬约束，本规范**不含任何密度锁定词** |
| 3 | **BG = 空镜无人；CG = 叙事构图** | BG 一律 `no people, empty scene`；CG 是叙事画，主体明确、情绪先于漂亮 |

**与既有代码的关系（复用，不新造）：**

- CG 前缀**沿用 `CG_STYLE`**（`spirits.js:6410`）一字不改；古风/负面位沿用 `GUOFENG`（`:548`）/ `NEG_STYLE`（`:538`）；解剖位 `ANATOMY`（`:544`）**仅用于 CG**（BG 无人，不需要）。
- 出图调用：`Spirits.generateCustom(prompt, { seedKey, variant, landscape: true })`。
- 尺寸档位沿用项目既有常量：`CG_IMG_SIZE = 1280` / `CG_IMG_SIZE_LOCAL = 768` / `CG_MAIN_SIZE = 1024` / `CG_MAIN_Q = 0.85` / `CG_THUMB_SIZE = 512` / `CG_THUMB_Q = 0.8`（`app.js:2712-2769`）。**BG 复用同一套档位概念**（见 §5）。
- ark 横版档位：`CG_SIZE_BY_PROVIDER.ark = ["2304x1728","2560x1440","2048x2048","1024x1024"]`（`spirits.js:1187`）。**16:9 对应 `2560x1440`**。

---

## 1. 统一 prompt 模板

### 1.1 BG 前缀 `BG_STYLE`（空镜 · 无人 · 横版 16:9）

字段顺序：**画风 → 介质 → 质感 → 光影 → 色调系统 → 构图 → 空镜声明**。

```
BG_STYLE =
2D hand-drawn background key art in traditional Chinese gufeng style, ancient Chinese
courtyard and alley setting, painterly flat-color illustration with soft cel shading,
silk, lacquer and weathered-wood material texture, classical Chinese color palette,
cinematic directional lighting with clear light source, atmospheric depth and haze,
WIDE LANDSCAPE HORIZONTAL COMPOSITION, 16:9 cinematic framing, empty scene, no people,
no figures, no characters, generous clean negative space, no text, no letters, no watermark,
no logo, single continuous scene, no split panels, no collage,
no modern elements, no Western elements, no Japanese elements
```

> ⛔ BG 前缀**不含 `ANATOMY`**（画里没有人）。⛔ **不含任何密度锁定词。**

### 1.2 CG 前缀 `CG_STYLE`（沿用代码 · 一字不改）

```
CG_STYLE =
2D hand-drawn key visual CG illustration in traditional Chinese gufeng style, ancient
Chinese scene and hanfu costume, cel shading, soft elegant Chinese classical palette,
cinematic lighting, atmospheric mood, detailed painted background with gentle bokeh,
expressive body language, warm cozy feeling, masterpiece quality,
WIDE LANDSCAPE HORIZONTAL COMPOSITION, 16:9 cinematic framing, wide scenery on both
sides, generous environment around the character, not a portrait, not a vertical poster,
no text, no letters, no words, no title, no labels, no watermark, no signature, no logo,
single continuous scene, no split panels, no collage
```

> 上面这段就是 `spirits.js:6410` 的原文（`CG_STYLE`），**架构师直接引用它**，本文件不重定义。
> 其后再拼 `ANATOMY` + `NEG_STYLE`（代码 `promptForCg`/`storyCgPrompt` 已在做）。

### 1.3 负面约束（复用 `NEG_STYLE`，逐字）

```
NEG_STYLE =
traditional Chinese styling only, strictly no Japanese elements (Japanese flag, rising sun
motif, kimono, yukata, torii gate, paper fan with red circle), strictly no modern or Western
clothing (no jacket, no hoodie, no sweatshirt, no T-shirt, no jeans, no denim, no sportswear,
no tracksuit, no suit and tie, no sneakers, no zipper coat), no peace sign or V-sign hand
gestures, no smirking or mischievous grin, no winking, no playful winks, no exaggerated
cartoon expressions, strictly no anatomy errors, use gentle neutral expressions and ancient
Chinese hanfu-inspired costume
```

### 1.4 构图规则

**BG（空镜）—— 立绘站位安全区：**

| 区域 | 占比 | 规则 |
|---|---|---|
| **立绘主站位列** | 画面**中下偏左或偏右**一列，约 **宽 40% × 高 70%** | **保持低细节、高留白**；不放高对比主体、不放密集纹理，避免立绘压上去糊成一团 |
| **对白框压盖带** | **底部 28%** | 只放低对比、可被遮的信息（地面、水、阴影）；不在最底部放任何关键道具 |
| **顶栏带** | **上缘 12%** | 保持简单干净（留给顶部按钮/状态条） |
| **视觉焦点** | **中上部**（画面 30%~60% 高度带） | 最亮/最细的位置放这里；BG-09/BG-15/BG-19 的牌·灯·坛放此带 |
| **左右边缘** | 各 **15%** | 可放院墙/门框/树做画框，但**不挤压立绘安全区的通透度** |

**院系复用机位（一次立机位、多次出光，省 5 张构图成本）：**
`BG-02 / BG-04 / BG-07 / BG-18 / BG-10` 同一座院子、同一机位（正视院中，石桌在偏侧，屋檐压顶）。**只换光与季节层**——prompt 里场景/构图句保持逐字一致，只改 `time` + `light` + `palette` 三段。这样出图后 5 张可直接叠同一套立绘坐标。

**CG（叙事）—— 景别明确、主体不居中不摆拍：**

- 每条**必写**：**景别**（close-up / medium / long / extreme close-up）+ **机位**（low-angle / overhead / from behind / profile）+ **主体位置**（left third / centre-lower / off-centre）+ **场景时间**。
- 结尾压一句**构图锁定**（权重最高位，见 `v164j §4.1`）：`framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background`。
- ⛔ 不写 `full body visible from head to toe`（那是立绘语言，会推翻景别）。

### 1.5 正例（拼装示例）

**BG 正例（BG-19 星月坛 · 内）：**
```
BG_STYLE, an ancient Chinese altar hall interior, a raised circular stone altar covered in a
dense pattern of countless small carved dots, a single tightly huddled bundle offering resting
on the altar, cold stone walls rising into darkness, one thin blade of pale daylight from a
narrow skylight far above, dark ink-blue and cold grey palette, one cold beam as the only light
source from directly above, oppressive deep shadow all around, wide horizontal composition with
the altar slightly off-centre and the light beam cutting the darkness, clear dark floor space in
the lower frame for character placement
```
→ 后接 `, ` + `"no people, empty scene, no figures"` + `NEG_STYLE`。

**CG 正例（CG-13 对面站着的，是你养出来的）：**
```
CG_STYLE, [该角色的 appearancePrompt + 发色/服装锚点，由代码提供], ANATOMY, <角色 立绘 作为参考图>,
a single character in ancient Chinese hanfu standing opposite the viewer across an ancient
Chinese courtyard at night, seen from the front, cold distant expression, snow on the ground and
a lamp behind casting a long shadow toward the viewer, cold blue palette with one warm accent,
wide horizontal narrative composition with the figure centre-right and empty snow between,
framing lock: follow the described camera and shot size exactly, not a front-facing standing
portrait, not centred in a plain empty background,
NEG_STYLE
```

---

## 2. BG 出图规范（共 21 张）

### 2.1 构图与比例

- **无人空镜**：每条以 `no people, empty scene` 收尾。
- **比例**：横版 **16:9**。ark 请求档 `2560x1440`。
- **长边**：出图后压缩到 **1280**（对齐 `CG_IMG_SIZE`），本地兜底 768（`CG_IMG_SIZE_LOCAL`）。见 §5。
- **立绘站位**：见 §1.4 安全区表；院系 5 张共用机位。

> ⚠️ **大纲与「空镜无人」冲突的 5 条，已按铁律 3 收敛为「不出人」**，并在各条标注（BG-05 / BG-07 / BG-10 / BG-13 / BG-17 / BG-21）。要出现人的画面，请改用对应 **CG 挂点**（已在此列明）。

### 2.2 逐条 prompt

> 下列英文 prompt 正文**纯英文、无中文残留、无 emoji**；直接拼在 `BG_STYLE, ` 之后，再接 `, no people, empty scene` 与 `NEG_STYLE`。

| id | 英文 prompt 正文 |
|---|---|
| **BG-01** 巷口石阶 · 晨雾 | `an ancient Chinese alley entrance at first light, worn stone steps descending into dense morning mist, the lowest steps polished shiny from years of footfall, alley walls dissolving into pale grey fog on both sides, cool grey-blue palette, soft diffuse dawn light from above and slightly behind, no hard shadows, mist pooling across the lower frame, wide horizontal composition with the steps low and centred and open fog-filled air above, generous clean empty space on the left and right for character placement, no people, empty scene` |
| **BG-02** 门内院子 · 晌午 | `a quiet ancient Chinese courtyard seen from inside at midday, a small stone table and stools at the side, freshly swept earth floor, cloth drying on a bamboo rack along one wall, tiled eaves and wooden door frames, warm noon sunlight pooling on the ground with soft leaf shadows, warm gold and jade palette, light from high above and slightly to one side, wide horizontal composition with the courtyard floor low and broad and clear open space left and right for character figures to stand, no people, empty scene` |
| **BG-03** 门口 · 傍晚 | `view from inside an ancient Chinese courtyard toward the open street gate at dusk, empty stone-paved lane beyond the threshold, distant sky pressing low with heavy dusk clouds, warm grey and muted amber palette, low warm light entering through the gateway from outside, the interior falling into gentle shadow, wide horizontal composition looking out through the door opening with the empty threshold low and centred, clear open space on both sides for character placement, no people, empty scene` |
| **BG-04** 院里 · 夜 | `an ancient Chinese courtyard at night, moonlight falling across the corner of a covered walkway, swept earth floor, a single oil lamp glowing under the eaves, tiled roofs and wooden pillars, cool blue night palette with one warm lamp accent, cold moonlight from high above and a small warm light source to one side, deep blue shadows, wide horizontal composition with the lamp and walkway at the side and the open courtyard low and centred, clear open space left and right for character figures, no people, empty scene` |
| **BG-05** 巷子尽头 · 雾 | `the far end of an ancient Chinese alley in thin early morning fog, a narrow lane between high grey-brick walls receding into white haze, faint blurred dark shapes dissolving into the mist far away reading as distant objects rather than people, cool desaturated grey palette, soft flat foggy light from the white sky above, low contrast, wide horizontal composition with the lane vanishing point slightly off-centre and the mist filling the upper frame, open empty space on the left and right for character placement, no people, empty scene` |
| **BG-06** 廊下 · 雨 | `under the eaves of an ancient Chinese covered corridor in steady rain, rainwater falling as continuous threads from the roof edge, wet slicked stone floor with shallow reflections, wooden pillars and tiled roof, muted grey-green palette, dim overcast light from the open courtyard beyond the rain curtain, cool diffuse low contrast, wide horizontal composition with the falling rain curtain across the frame and the wet floor low and centred, clear dry open space left and right for character placement, no people, empty scene` |
| **BG-07** 院中石桌 · 黄昏 | `an ancient Chinese courtyard with a single round stone table and one stone stool at golden hour, the tabletop completely bare, swept earth floor, tiled roof edge and a tree branch framing the top, low golden sun raking from one side casting long soft shadows, warm amber and honey palette, wide horizontal composition with the empty table low and slightly off-centre and open glowing sky above, generous clear space on the left and right for character placement, one place setting but nobody seated, no people, empty scene` |
| **BG-08** 巷子 · 秋 | `an ancient Chinese alley in autumn afternoon, grey-brick courtyard walls on both sides, a few fallen golden leaves scattered on the stone path, bare branches overhanging the top of the frame, warm russet and straw palette, low slanting golden autumn sun from one side casting long thin shadows across the lane, wide horizontal composition with the lane receding and the walls framing both edges, clear open space on the left and right for character placement, no people, empty scene` |
| **BG-09** 挂榜处 · 院门内 | `an ancient Chinese courtyard just inside the gate used as an announcement spot, a large wooden board and an open ledger book set on a stand, rows of faint vertical name marks inked on the board, spare and solemn, cool pale daylight palette, flat cool light from the open sky above with one soft directional source from the side, wide horizontal composition with the board reading as the focal point slightly above centre and the standing ground low and clear, open space on both sides for character placement, no people, empty scene, no readable letters` |
| **BG-10** 雪夜院中 | `an ancient Chinese courtyard at night in falling snow, snow piled on the tiled roofs and courtyard walls, the swept ground covered in fresh white snow with a clean untouched surface, bare branches catching snow, cold blue-white night palette, dim blue moonlight from above and a faint warm lamp glow at the eaves, wide horizontal composition with the snowy courtyard floor low and broad and the roofs and sky above, clear open space on the left and right for character placement, no people, empty scene` |
| **BG-11** 别家门第 · 门外 | `the grand gateway of a wealthy ancient Chinese family seen from the street at dusk, imposing lacquered double doors, a tall stone threshold and steps, brass door rings and lintel carvings, a long row of paired door lanterns glowing evenly along the facade, warm dusk palette with rich red-brown and amber, warm lantern light from both sides meeting the fading blue sky above, wide horizontal composition with the doors centred and the steps low and the lantern line crossing the frame, clear open space at the foot of the steps for character placement, no people, empty scene` |
| **BG-12** 收旧物的铺子 · 内 | `the interior of an ancient Chinese antique-and-secondhand shop, tall shelves crowded with old objects, jars, boxes and rolled scrolls, an open ledger and ink brush on a low counter, a single shaft of dusty light falling from a high window, dark amber and umber palette, one strong directional light column from above cutting through the gloom, everything else in deep shadow, wide horizontal composition with the light shaft slightly off-centre and the shelves framing both sides, clear dark floor space in the lower frame for character placement, no people, empty scene` |
| **BG-13** 坡地 · 黄昏 | `an open hillside with a path winding upward and away into the distance at dusk, long grass and low scrub, bare earth trail, layered hills fading on the horizon, warm dusk palette of rose and violet and deep gold, low warm light from the horizon behind the hills, long shadows stretching toward the viewer, wide horizontal composition with the path leading up from the lower frame to a high horizon and a vast open sky above, clear empty ground in the lower frame for character placement, no people, empty scene` |
| **BG-14** 空屋 · 积尘 | `the interior of a long-abandoned ancient Chinese room, bare wooden furniture, a dusty bed frame, cobwebs, a fallen stool and scattered disturbed objects, fine dust floating in the air, everything covered in a grey film, muted sepia and grey palette, soft afternoon light entering from one side through a paper window, visible dust motes in the beam, wide horizontal composition with the disturbed corner slightly off-centre and the empty floor low and broad, clear open floor for character placement, no people, empty scene` |
| **BG-15** 灯下账桌 | `a close view of an ancient Chinese accounting desk at night, a low wooden table with one lit oil lamp, an open ledger book with faint tally marks and a writing brush resting on a stand, an abacus to the side, a cup of cold tea, warm amber and deep brown palette, one warm lamp as the single light source from one side throwing long shadows, the rest of the room in darkness, wide horizontal composition with the desk low and centred and the lamp glow pooling on the ledger, clear dark space at the near edge for character placement, no people, empty scene, no readable letters` |
| **BG-16** 天劫 · 夜空 | `a vast night sky over an ancient Chinese roofscape, dark clouds churning low, a single jagged crack of cold white light splitting the heavens and pressing down toward the ground, faint distant rooftops along the bottom, cold blue-black and pale white palette, one intense cold light source from the crack above and behind, everything else in deep night, wide horizontal composition with the sky filling the upper four fifths and the rooftops as a thin band at the very bottom, clear open dark lower frame for character placement, no people, empty scene` |
| **BG-17** 铺门外 · 街市一角 | `a corner of an ancient Chinese market street in daytime, wooden shop fronts with hanging cloth signs and banners, stacked goods and baskets by the doors, a narrow lane curving away, distant rooftops and a thin drift of far smoke on the horizon, warm daylight palette of ochre and jade and faded red, bright even daylight from a high sun with soft shadows, wide horizontal composition with the shop front slightly off-centre and the lane leading the eye away, clear open ground in the lower frame for character placement, no people, empty scene, no figures in the foreground` |
| **BG-18** 院内 · 晨 | `an ancient Chinese courtyard at the first light of morning, thin mist rising off the damp swept ground, water droplets on the eaves, tiled roofs and a wooden door frame catching the first warm light, a clean quiet scene that feels newly made, fresh warm-white and pale jade palette, soft low warm morning sun from one side with gentle mist glow, wide horizontal composition with the courtyard floor low and clear and the sky pale above, generous open space on the left and right for character placement, no people, empty scene` |
| **BG-19** 星月坛 · 内 | `the interior of a mysterious ancient Chinese altar hall, a raised circular stone altar in the centre covered in a dense pattern of countless small carved dots, on the altar rests a single tightly huddled bundle-like offering wrapped close, cold stone walls rising into darkness, one thin blade of pale daylight falling from a narrow skylight far above, dark ink-blue and cold grey palette, one cold beam of light as the only source from directly above, oppressive deep shadow all around, wide horizontal composition with the altar slightly off-centre and the light beam cutting the darkness, clear dark floor space in the lower frame for character placement, no people, empty scene` |
| **BG-20** 巷尾 · 夜 | `the dark dead-end of an ancient Chinese alley at deep night, high courtyard walls, one section of the wall visibly disturbed and pushed askew, a bare moonlit lane, cold grey and blue palette, pale moonlight from above throwing hard shadows, everything low contrast and cold, wide horizontal composition with the lane receding and the disturbed wall at one side, clear open moonlit ground in the lower frame for character placement, no people, empty scene` |
| **BG-21** 院门外 · 雪夜对峙 | `the outside of an ancient Chinese courtyard gate at night in heavy falling snow, closed lacquered doors with brass rings, a stone step and a threshold, snow piling on the ground and the roof edge, fresh footprints in the snow leading up to the gate from the front and stopping there, cold blue-white palette, dim moonlight through the snowfall and a faint warm light seeping from under the doors, wide horizontal composition with the gate centred and the snowy ground low and broad, clear open snow in the foreground for character placement, no people, empty scene` |

**冲突收敛清单（大纲原句 → 本规范处理）：**

| id | 大纲原句 | 处理 | 人群改走哪个挂点 |
|---|---|---|---|
| BG-05 | 「雾里几道人影轮廓」 | 改为「远处模糊暗形溶于雾」，不出人 | 需要远景人影 → 用 CG-20 围巷 |
| BG-07 | 「一人一桌」 | 只出「空石桌 + 一只石凳」，不坐人 | 坐姿场景 → CG-08 或 CG-19 |
| BG-10 | 「院里站着几个人」 | 改为「崭新未踏的雪地」（连脚印都不留，保干净） | 群人 → CG-19 并肩 / CG-21 榜前 |
| BG-13 | 「人各走各的」 | 只出「向上向远的路」，不出人 | 分散人影 → CG-14 十二道身影 |
| BG-17 | 「远处人烟」 | 改为「远处屋顶 + 一缕远烟」，不出人 | 街市人群 → 需要时另开 CG |
| BG-21 | 「门里门外两方对望」 | 只出「门外 + 门前雪 + 脚印到此为止」 | 对望双人 → CG-15 / CG-16 / CG-17 |

---

## 3. CG 出图规范（共 22 条）

### 3.1 构图与一致性

- **横版叙事图**：主体明确，**情绪先于漂亮**。景别/机位/主体位置必写（见 §1.4）。
- **一致性（`CG 拿立绘当参考`）**：
  1. 出现**具名沁灵**的 CG → **必须把该只的立绘当作参考图**（ark 支持 `image` 字段，不额外收费，见 `spirits.js:1198`），提示词尾追加 `consistent with the character reference art style and costume`。
  2. **非沁灵角色**（门客 / 坛主 / 掠客黑影 / 别家）**无立绘** → 不做参考图，**设计写死在 prompt 里**（服装、姿态，不带面部特写）：
     - **门客**（CG-01）：中年男客，深褐中式长衫，立姿沉静，不卑不亢。
     - **坛主**（CG-07/CG-12）：中年男，**深色道袍式长衣**，立姿端方，明面讲礼。
     - **掠客/黑影**（CG-04/CG-20）：**不画脸**，只作黑影/剪影，冷硬。
  3. **CG-01~04 必须准确对应大纲**（逐字对齐，已核对）：

     | 挂点 | 大纲原句（逐字） | 本规范主体 |
     |---|---|---|
     | **CG-01** | 门客立在院中、话难听理不歪 | 门客**立在院中**，冷言、姿态不动 |
     | **CG-02** | 最小的在月下朝自己选的那边走半步 | 最小的**月下**、**朝自己选的那边**、**走半步** |
     | **CG-03** | 榜挂出来的那一面木牌 | **那一面木牌**刚挂出来（物体为主体） |
     | **CG-04** | 被挡在院门外的黑影 | **黑影**、**被挡在院门外** |

- **CG-22 四结局用 `variant` 区分**（base 相同，仅尾段不同），seedKey 仍为 `26#CG-22`，`variant: 0..3`。

### 3.2 逐条 prompt

> 下列英文 prompt 正文**纯英文、无中文残留、无 emoji**。拼接顺序：`CG_STYLE, ` + 角色外貌锚点（代码给）+ `ANATOMY, ` + **下面正文** + `, NEG_STYLE`。具名沁灵另加参考图与 `consistent with the character reference art style and costume`。

| id | 章 | 英文 prompt 正文 |
|---|---|---|
| **CG-01** | 1 | `a single standing adult visitor figure in ancient Chinese hanfu, a middle-aged male guest in a dark brown long robe, seen in the middle distance framed at three-quarter height, standing still in the centre of a quiet ancient Chinese courtyard, arms lowered, posture composed and unmoved, a cold hard-to-argue expression, a faint cutting chill in the air, swept earth floor with tiled eaves and a stone table behind, cool afternoon light entering from one side so the figure stands half in shadow, wide horizontal narrative composition with the figure slightly left of centre and open empty courtyard around, mood of an uninvited guest whose words are cold but not wrong, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-02** | 3 | `a single young character in ancient Chinese hanfu taking half a small step forward along one path under bright moonlight, seen from a three-quarter rear angle, the body leaning slightly toward the chosen direction, hesitant but resolute, a night courtyard with two diverging paths, a tiled roof corner and a bare tree, cool blue moonlight from above with a soft rim light along the shoulders, wide horizontal narrative composition with the character small and placed low and one side of the frame opening onto the chosen path, mood of a first private choice, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-03** | 4 | `a large wooden announcement board freshly hung on an ancient Chinese courtyard wall, rows of fine vertical name marks inked faintly across its face, a curled corner of red paper at the edge, the board as the clear subject filling the centre of the frame, cool pale daylight from the side grazing the wood grain, a hand just withdrawing at the very edge of the frame, wide horizontal narrative composition with the board slightly off-centre and the wall and ground around it, mood of a public list newly posted and the weight it carries, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background, no readable letters` |
| **CG-04** | 4 | `a menacing dark silhouette of an intruder blocked and stopped just outside an ancient Chinese courtyard gate at night, the figure reduced to a black shadow with only a thin cold rim light, one hand pressed flat against the closed door, the gate lit by faint moonlight, a low warm lamp line seeping from the gap beneath the door, deep cold blue-black palette, wide horizontal narrative composition with the dark figure at one side and the closed gate filling the frame, tense oppressive mood of something dangerous held out, no facial features, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-05** | 7 | `a single character seen entirely from behind standing squarely in the mouth of a narrow pass, an ancient Chinese hanfu figure with shoulders set and feet planted blocking the way, facing a dark concealed opponent in the shadows ahead, dim light from behind silhouetting the figure and a cold gloom swallowing the front, wide horizontal narrative composition with the figure low and centred and the dark threat ahead, mood of a brief heroic stand with the cost hidden in the dark, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-06** | 8 | `a single fading character in ancient Chinese hanfu standing still in an ancient Chinese courtyard, the ground shadow beneath the figure rendered noticeably thin and pale and half-transparent as if thinning away, the character's expression dim and absent-minded, soft overcast daylight, a bare stone floor, muted desaturated palette, wide horizontal narrative composition with the figure placed to one side and a large expanse of empty ground where a full shadow should fall, quiet aching mood of a slow loss, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-07** | 9 | `a stern adult sect leader in dark ancient Chinese long robes standing at the foot of a stone staircase, holding up an open ledger book toward a tall wooden announcement board, a calm courteous posture with a cold hidden intent, an ancient Chinese courtyard at the base of a raised hall, cold pale daylight from one side, the stairs and the board framing the composition, wide horizontal narrative composition with the standing figure low and slightly off-centre and the raised board above, mood of polite words over a hidden demand, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background, no readable letters` |
| **CG-08** | 9 | `a circle of several deliberately placed figures in ancient Chinese hanfu standing in front of a large wooden announcement board in an ancient Chinese courtyard, all seen from behind or in profile at a respectful distance, heads tilted up reading the rows of faint marks, one central figure slightly separated, cool pale daylight, wide horizontal narrative composition with the board as the focal point and the ring of people opening toward the viewer, mood of quiet dread as names are counted, keep exactly this small group, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background, no readable letters` |
| **CG-09** | 11 | `a close view over an ancient Chinese ledger book under a single oil lamp at night, three entries visibly struck through with heavy ink strokes, a writing brush laid down across the page, a warm lamp flame at one side, deep shadows all around, warm amber and deep brown palette, wide horizontal narrative composition with the open ledger low and centred and the lamp glow pooling on the crossed-out lines, mood of three hard choices withdrawn and the ache of them, no people visible, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background, no readable letters` |
| **CG-10** | 12 | `the ground-level detail of an old worn stone step inside a dusty abandoned ancient Chinese house, a shallow depression worn into the stone by years of footsteps with one neighbouring step strangely bare and unworn as if a level is missing, fine dust and debris, faint afternoon light from one side raking across the stone, muted sepia and grey palette, wide horizontal narrative composition with the worn step low and centred and the empty room receding beyond, cold unsettling mood of a trace where something should be but is not, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-11** | 13 | `a grand ancient Chinese mansion gateway seen from outside at dusk with two long rows of paired door lanterns glowing evenly along the steps, imposing lacquered doors and brass rings, tall stone steps, well-kept and prosperous, warm amber lantern light against a fading blue sky, wide horizontal narrative composition with the gateway slightly off-centre and the steps leading down toward the viewer, mood of another family's order and wealth seen from below, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-12** | 14 | `the interior of a dark ancient Chinese altar hall, a close view of a raised stone altar covered in a dense pattern of countless small carved dots, an adult sect leader's hand reaching in from the side to touch the pattern, the altar holding a tightly huddled bundle offering, one thin cold beam of light from far above falling on the hand and the altar, dark ink-blue and cold grey palette, wide horizontal narrative composition with the altar slightly off-centre and the reaching hand entering the frame, mood of an offered bargain and a quiet threat, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-13** | 15 | `a single character in ancient Chinese hanfu standing opposite the viewer across an ancient Chinese courtyard at night, seen from the front, cold distant expression, snow on the ground and a lamp behind casting a long shadow toward the viewer, cold blue palette with one warm accent, wide horizontal narrative composition with the figure centre-right and empty snow-covered ground between, heartbreaking mood of a familiar face on the wrong side, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-14** | 16 | `twelve separate characters in ancient Chinese hanfu spread across an open hillside at dusk, each turned toward a different direction and walking their own separate path, seen mostly from behind at a distance, strung out across the slope, layered hills and a wide sky behind, warm dusk palette of rose and violet, low light from the horizon, wide horizontal narrative composition with the twelve figures small and widely spaced across the lower half and a vast sky above, mood of pride mixed with loss as everyone goes their own way, keep exactly twelve figures, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-15** | 17 | `two characters in ancient Chinese hanfu in falling snow, one standing inside an ancient Chinese courtyard gate and one outside, a half-open wooden door between them, both facing each other across the threshold, one reaching toward the door, gentle and hesitant, snow falling heavily, cold blue-white palette with a faint warm light through the doorway, wide horizontal narrative composition with the door at the centre dividing the frame and the two figures on either side, intimate melancholy mood, keep exactly two figures, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-16** | 18 | `a single character in ancient Chinese hanfu seen entirely from behind standing guard at an ancient Chinese courtyard gate at night, feet planted and shoulders squared, facing out into the dark snowy lane, a long shadow cast back toward the viewer, faint warm garden light behind from the courtyard and cold moonlight ahead, wide horizontal narrative composition with the figure low and centred and the dark lane opening beyond, mood of a quiet first night standing watch and keeping the threat out, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-17** | 19 | `two characters in ancient Chinese hanfu, one inside and one outside an ancient Chinese doorway, facing each other across a raised wooden threshold, seen in profile from the side, one figure waiting on the inside while the other stands alone on the outside, cold grim light at night, a stark division of warm interior and cold exterior, wide horizontal narrative composition with the threshold vertical at the centre and the two figures balancing either side, mood of being shut on opposite sides of one moment, keep exactly two figures, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-18** | 20 | `a single character in ancient Chinese hanfu seen from behind at a distance, walking away and taking the decisive own step forward alone, crossing a line on an open path at dusk, the figure small and moving away with a determined stride, a wide luminous sky opening ahead, warm gold and soft violet palette, low warm backlight from the horizon, wide horizontal narrative composition with the figure small and low, placed off-centre, and a large open bright space ahead, mood of finally letting go, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-19** | 21 | `several characters in ancient Chinese hanfu standing side by side seen entirely from behind, of varying number, forming a row shoulder to shoulder at night in an ancient Chinese courtyard, snow on the ground, all facing the same direction into the dark, a faint warm lamp behind casting long shadows toward the viewer, cold blue palette with warm accents, wide horizontal narrative composition with the row low and centred and the dark distance ahead, mood of turning to look and counting who is still standing behind you, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-20** | 23 | `an ancient Chinese alley seen from inside at night, dark armed figures blocking the lane at both ends and along the top of the courtyard walls, closing in, torchlight and cold moonlight mixing, grey-clad intruders with no clear faces, a tense standoff, cold grey and black palette with warm torch accents, wide horizontal composition with the alley receding and the encircling figures pressed to the edges of the frame, claustrophobic threatening mood of being surrounded, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background` |
| **CG-21** | 24 | `a close narrative view of a large wooden announcement board with rows of fine faint name marks in an ancient Chinese courtyard at night, a small knot of figures in ancient Chinese hanfu gathered tense and silent before it, one figure reaching out with a hand not yet touching the board, cold pale light from one side and a faint warm lamp, wide horizontal narrative composition with the board centre and the tense figures low and to one side, breath-held mood as the names are matched one by one, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background, no readable letters` |
| **CG-22** | 26 | 见下方「四结局分版」；base 相同，按 `variant` 取尾段 |

**CG-22 岁除之夜（四结局分版，`variant: 0..3`）：**

- **公共 base**（四版共用）：
  `the great final night of an ancient Chinese year, a wide snow-covered ancient Chinese courtyard under a cold broken night sky split by a single crack of pale light, an ancient Chinese family gathering in the courtyard, cinematic key visual, cold blue-white palette with warm lantern accents, wide horizontal composition, framing lock: follow the described camera and shot size exactly, not a front-facing standing portrait, not centred in a plain empty background`
- **`variant 0` · GRAND 大团圆**：
  `twelve figures filled into twelve places, none missing, the group standing close and whole at the centre, the encircling crowd pushed back outside the gate, a warm lamp glow over the whole courtyard, mood of a complete reunion with every position filled`
- **`variant 1` · HE**：
  `the same family group standing together but a few bearing visible signs of hurt, all still present, latecomers stepping in from the snow, warm light breaking through, mood of everyone back though scarred, no one left out`
- **`variant 2` · NE**：
  `the family group standing quietly but with one place visibly empty, an extra bowl and a pair of chopsticks set on a table that nobody touches, cold quiet light, snow falling, mood of an incomplete table and a quiet wait`
- **`variant 3` · BE**：
  `the courtyard nearly empty save for one figure standing alone over an open ledger, one name left unwritten on the board, the brush laid down beside it, a single cold light, mood of someone who did not return and a line not crossed out`

---

## 4. seedKey 命名约定（供工程直接用）

> 机制：`seedOf(id, variant) = (hashStr(id) % 900000) + 1000 + variant * 7919`（`spirits.js:1871`）。
> **同一个 `seedKey` + 同一个 `variant` → 同一个 seed → 同一张画**。这是「不重复出图、一次出图永久复用」的落点：出图前先查缓存（Supabase Storage 永久 URL / IndexedDB），命中即不再调用 `generateCustom`。

| 类型 | seedKey 规则 | 示例 | 共享范围 | variant 用法 |
|---|---|---|---|---|
| **BG** | `"bg:" + key` | `"bg:BG-01"` … `"bg:BG-21"` | **全局共享**，一次出图永久复用（全 26 章共用同一张） | 恒为 `0`（如将来只为换光层另出，用 `1,2…`，但**默认不复出**） |
| **CG** | `"<chapterNo>#<cgKey>"` | `"1#CG-01"`、`"4#CG-03"`、`"26#CG-22"` | **按挂点唯一**，一个挂点一张 | CG-22 用 `0..3`（四结局）；其余恒 `0` |

**调用示例：**

```js
// BG-01（全局共享，空镜）
Spirits.generateCustom(BG_PROMPT_BODY, { seedKey: "bg:BG-01", variant: 0, landscape: true });

// CG-03（第 4 章挂点）
Spirits.generateCustom(CG_PROMPT_BODY, { seedKey: "4#CG-03", variant: 0, landscape: true });

// CG-22 大团圆结局（四版之一）
Spirits.generateCustom(CG_22_BASE + ", " + CG_22_GRAND, { seedKey: "26#CG-22", variant: 0, landscape: true });
```

> `chapterNo` 用**真实章号 1–26**（对齐 `v165-故事大纲.md` 章表）。CG 挂点缺省 `variant = 0`。

---

## 5. 出图精度与体积建议

| 类别 | 出图请求档（ark） | 云端存图长边 | 质量 | 本地兜底长边 | 质量 | 缩略图长边 | 质量 | 目标体积/张 |
|---|---|---|---|---|---|---|---|---|
| **BG** | `2560x1440`（16:9） | **1280** | **0.88** | 768 | 0.86 | 512 | 0.8 | **180–320 KB** |
| **CG 主线** | `2560x1440`（16:9） | **1024**（`CG_MAIN_SIZE`） | **0.85**（`CG_MAIN_Q`） | 768 | 0.86 | 512（`CG_THUMB_SIZE`） | 0.8（`CG_THUMB_Q`） | **200–350 KB** |
| **CG 单张突破**（若走 1280 档） | `2560x1440` | **1280**（`CG_IMG_SIZE`） | **0.9** | 768（`CG_IMG_SIZE_LOCAL`） | 0.86 | 512 | 0.8 | **250–450 KB** |

**说明：**

- **比例一致性**：BG/CG 均按 **16:9** 构图、请求 `2560x1440`。⚠️ ark 首选档 `2304x1728` 实为 **4:3**，若管线回落到它，请按 §1.4 把主体压在**画面中央 16:9 安全框**内，避免裁切丢主体。（此为已知历史冲突，见 `v164j §0 附带发现 a`。）
- **主 load 到相册/场景的只有缩略图 512**，禁把 1024/1280 塞进小格子。
- **落 Supabase Storage 换永久 URL，不重复出图**；本地 IndexedDB/localStorage 仅作兜底与离线缓存。
- 全部数值**可配置**（不硬编码），集中到配置项，架构师按项目既有 `const` 风格落。

---

## 6. 成本提示

- 单张约 **¥0.03**。
- 本轮总量：**21 BG + 22 CG = 43 张 ≈ ¥1.29**。
- 若 CG-22 四结局**全部出图**（variant 0/1/2/3）→ **46 张 ≈ ¥1.38**。
- **一次出图永久复用**：同 seedKey 命中缓存即 0 成本重放；⛔ 未确认绝不出图（沿用 `v163` 铁律 2）。

---

## 7. 自检

| 检查项 | 结果 |
|---|---|
| BG 条数 | **21**（BG-01 … BG-21） |
| CG 条数 | **22**（CG-01 … CG-22，CG-22 含 4 结局分版） |
| 英文 prompt 正文**无中文残留** | ✅ 全部纯英文 |
| 英文 prompt 正文**无 emoji** | ✅ 0 处 |
| **无任何密度锁定词**（DENSITY LOCK / 密排 / 等距 / 刻意稀疏） | ✅ 0 处 |
| **无现代 / 西式 / 日式元素** | ✅ 0 处（含 `NEG_STYLE` 负面位） |
| BG 全部含 `no people, empty scene` | ✅ 21/21 |
| CG-01~04 逐字对齐大纲四句 | ✅ §3.1 表 |
| seedKey 约定明确（BG `bg:<key>`；CG `<ch>#<cgKey>`） | ✅ §4 |
| 精度/体积/成本给出 | ✅ §5 / §6 |
| 改动 `js/` 代码 | **0 行** ✅ |

*—— 颜配色 · v165*

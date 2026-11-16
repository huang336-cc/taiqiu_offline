/**
 * 主菜单逻辑（纯离线，无任何网络请求）
 *
 * 设置数据与游戏内共用同一份 localStorage，键名保持一致。
 */
;(function () {
  "use strict"

  var STORAGE_KEY = "billiards_cn_settings_v1"

  // ===== v1.3.19 多语言（i18n）=====
  // 画质档位 / 辅助线档位 / 各玩法规则：按语言分别给出。
  var I18N = {
    zh: {
      quality: [
        "极速（像素风，最省电）",
        "流畅（低配手机推荐）",
        "标准",
        "高清（推荐）",
        "超清（开启抗锯齿）",
        "极致（高端手机）",
      ],
      qualityHint: [
        "以极低分辨率渲染，画面为像素风格，帧率最高、最省电。",
        "降低渲染分辨率与球体精度，适合入门机型与老旧设备。",
        "常规画质，多数中端手机可稳定运行。",
        "较高的渲染分辨率与球体精度，兼顾清晰度与流畅度。",
        "开启抗锯齿，边缘更平滑，建议中高端机型使用。",
        "最高渲染精度，仅建议旗舰机型开启，耗电较高。",
      ],
      tline: ["关闭", "短", "中", "最长"],
      modeRules: {
        nineball: {
          title: "九球规则",
          body:
            '<div class="guide-block"><h3>九球</h3><p>台面上有 1~9 号球。每次击球必须先碰到台面上号码最小的球，任何球落袋都算得分并可继续击球。谁先合法打进 9 号球即获胜。</p></div>' +
            '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>母球落袋</li><li>空杆（未击中任何球）</li><li>首个击中的球不是台面号码最小的球</li><li>击球后无任何球碰库且无球落袋</li></ul><p class="about-text dim">犯规后对手获得自由球，可任意摆放母球。</p></div>',
        },
        eightball: {
          title: "八球规则",
          body:
            '<div class="guide-block"><h3>八球</h3><p>开球后由第一颗合法落袋的球确定己方球组（全色 1~7 或花色 9~15）。清完己方球组后，最后打进黑 8 者获胜。黑 8 提前落袋判负。</p></div>' +
            '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>母球落袋</li><li>空杆（未击中任何球）</li><li>开局先碰黑八，犯规</li><li>先碰到了对方的球</li><li>本方球已清台，必须先碰黑八（否则犯规）</li><li>击球后无任何球碰库且无球落袋</li></ul><p class="about-text dim">犯规后对手获得自由球，可任意摆放母球。</p></div>',
        },
        snooker: {
          title: "斯诺克规则",
          body:
            '<div class="guide-block"><h3>球与台</h3><p>标准 12 英尺斯诺克台（3569×1778 mm）。台面共有 22 颗球：<b>15 颗红球</b>（每颗 1 分）+ <b>6 颗彩球</b>：黄（2）、绿（3）、棕（4）、蓝（5）、粉（6）、黑（7）。开球前红球摆成三角形紧贴粉球所在点位，彩球摆在各自的置球点：黄、绿、棕在开球线（baulk line）一侧由右向左排列，蓝球摆在台面正中心，粉球在两腰袋之间的中线点，黑球在远离开球区那一端的底库点。</p></div>' +
            '<div class="guide-block"><h3>开球（Break）</h3><p>开局母球从开球半区（D 区内）任意位置出杆，目标是先把红球三角架至少一颗合法入袋或至少四颗球（含母球）碰撞台边。母球必须先碰到一颗红球——否则直接判违例。<b>开球不入任何红球</b>也合法，但下一杆对手拥有「推杆」选项：声明「推杆」后该手只需把母球碰到任意球即可得分。</p></div>' +
            '<div class="guide-block"><h3>阶段与交替</h3><p>得分后保持连续击球（continue break）：<b>红球阶段</b>选手必须先击一颗红球入袋，然后才能击一颗彩球入袋；红球留在袋内不取出，<b>彩球进袋后必须从置球点复原</b>。当台面最后一颗红球入袋后即进入<b>清彩阶段</b>（black-ball stage），按固定顺序依次击打黄、绿、棕、蓝、粉、黑。</p></div>' +
            '<div class="guide-block"><h3>计分与满分杆</h3><p>红球 1 分一颗；彩球按颜色（黄 2/绿 3/棕 4/蓝 5/粉 6/黑 7）。理论最高单杆是「<b>147</b>」——开球后红球阶段连续 15 次红 + 黑（每红 + 黑 = 8 分），15×8 + 清彩黄→绿→棕→蓝→粉→黑（2+3+4+5+6+7=27）= 147。常规单杆清台（15 红 + 单杆清彩）通常落在 67~84 之间。</p></div>' +
            '<div class="guide-block"><h3>置球点（Re-spot）</h3><p>彩球进袋后必须摆回自己的置球点；若置球点被占，则摆到<b>最近可用的</b>（先靠近的）点位；若整个点位全都不可用，该彩球<b>留在袋内不摆回</b>，但在彩球阶段还要再复位出袋。红球全部入袋后，所有彩球按规则复位后即进入清彩；最后只剩黑球在袋口时击不进黑球即判负。</p></div>' +
            '<div class="guide-block"><h3>自由球（Free Ball）</h3><p>对手犯规后，下一杆选手可<b>声明「自由球」</b>：把任意一颗非红球当红球对待（先合法碰它即等同先碰红球），但得分仍按该球的分值。这一规则专门用于「对手犯规后母球被锁死」，让母球绕道碰到那一颗「当红球」就能解死局。</p></div>' +
            '<div class="guide-block"><h3>犯规（Foul）</h3><ul class="guide-list"><li>母球落袋（<b>白球摔袋</b>）</li><li>空杆（未击中任何球）</li><li>首碰目标错误：红球阶段碰了非红球，或彩球阶段碰了非目标彩球</li><li>击球后无任何球碰库且无球落袋（除非开球）</li><li>用身体、衣物或杆以外的物品触球</li><li>连击、双脚离地、出杆时杆头仍贴母球</li></ul><p class="about-text dim">犯规判罚：对手获得 <b>「最高分值彩球」的分数</b> 作为直接得分（黄 2 ~ 黑 7，所以<b>最低 4 分</b>，最高 7 分），并执行下一杆。若对手仍能直接碰红球即得 1 分。犯规后母球位置由下一杆选手决定，可保留原位或重摆。</p></div>' +
            '<div class="guide-block"><h3>清彩顺序</h3><p>红球清空后，剩下的彩球按以下顺序入袋：<b>黄 2 → 绿 3 → 棕 4 → 蓝 5 → 粉 6 → 黑 7</b>。中途任一颗失误（未先碰目标球）即犯规加换手；黑球是最后一颗——黑球落袋的那一刻，<b>分数高者获胜</b>。</p></div>' +
            '<div class="guide-block"><h3>胜负</h3><p>判定胜负的瞬间有以下三种：① 一方认输（concede）；② 任意球自然落袋导致「台面已清」（包括彩球阶段清台但还剩未打的彩球）；③ <b>「C&middot;B&middot;W」自然终局</b>——出杆者在执行最后一次击球时犯规（含母球摔袋、首碰错误、未碰库），比赛立即结束，分数高者胜。本离线版采用<u>比分判定 + 自然终局</u>相结合，进程控制台可随时查看当前双方分数。</p></div>',
        },
        threecushion: {
          title: "三库开伦规则",
          body:
            '<div class="guide-block"><h3>三库开伦</h3><p>无袋球台。母球需先碰到库边至少三次，再撞到另外两颗球，即得 1 分。得分后可继续击球，未得分则换手。</p></div>' +
            '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>未先碰库边三次即撞到第二颗球</li><li>空杆（未击中任何球）</li></ul><p class="about-text dim">犯规后换手，由对手击球。</p></div>',
        },
      },
    },
    en: {
      quality: [
        "Ultra Lite (pixel art, most power-saving)",
        "Smooth (for low-end phones)",
        "Standard",
        "HD (recommended)",
        "Sharp (antialiasing on)",
        "Ultra (high-end phones)",
      ],
      qualityHint: [
        "Renders at very low resolution with a pixel-art look; highest frame rate and lowest power use.",
        "Lowers render resolution and ball detail; good for entry-level and older devices.",
        "Standard quality; runs stably on most mid-range phones.",
        "Higher render resolution and ball detail, balancing clarity and smoothness.",
        "Enables antialiasing for smoother edges; recommended for mid-to-high-end devices.",
        "Highest render quality; only recommended for flagship devices, higher power draw.",
      ],
      tline: ["Off", "Short", "Medium", "Longest"],
      modeRules: {
        nineball: {
          title: "9-Ball Rules",
          body:
            '<div class="guide-block"><h3>9-Ball</h3><p>Balls 1–9 are on the table. You must hit the lowest-numbered ball first; any ball pocketed counts and you keep shooting. Pocket the 9-ball legally to win.</p></div>' +
            '<div class="guide-block"><h3>Fouls</h3><ul class="guide-list"><li>Cue ball pocketed</li><li>No ball hit</li><li>First ball struck is not the lowest on the table</li><li>After the shot no ball hits a rail and none is pocketed</li></ul><p class="about-text dim">After a foul the opponent gets ball-in-hand and may place the cue ball anywhere.</p></div>',
        },
        eightball: {
          title: "8-Ball Rules",
          body:
            '<div class="guide-block"><h3>8-Ball</h3><p>After the break, the first legally pocketed ball decides your group (solids 1–7 or stripes 9–15). Clear your group, then pocket the black 8 to win. Pocketing the 8 early loses.</p></div>' +
            '<div class="guide-block"><h3>Fouls</h3><ul class="guide-list"><li>Cue ball pocketed</li><li>No ball hit</li><li>First contact is the 8-ball on the break (foul)</li><li>Hit opponent ball first</li><li>After clearing your group you must hit the 8 first (otherwise foul)</li><li>After the shot no ball hits a rail and none is pocketed</li></ul><p class="about-text dim">After a foul the opponent gets ball-in-hand and may place the cue ball anywhere.</p></div>',
        },
        snooker: {
          title: "Snooker Rules",
          body:
            '<div class="guide-block"><h3>Balls &amp; Table</h3><p>A standard 12 ft snooker bed (3569×1778 mm) holds <b>22 balls</b>: 15 reds (1 pt each) + 6 colours — yellow 2, green 3, brown 4, blue 5, pink 6, black 7. At the start, the reds are racked in a triangle against the pink spot; the colours sit on their spots — yellow / green / brown on the baulk line (right-to-left), blue at the table centre, pink between the side pockets, black at the foot spot.</p></div>' +
            '<div class="guide-block"><h3>The Break</h3><p>The cue ball is played from anywhere inside the D. The first shot must strike a red or be ruled a foul. A break that pockets at least one red, or drives at least four balls (cue included) to a cushion, is <b>legal</b>. If no red is potted the opponent may call <b>“push”</b> and only needs to touch a ball legally on their turn.</p></div>' +
            '<div class="guide-block"><h3>Phases</h3><p>After a successful pot you stay at the table (continue break). In the <b>red phase</b> you must pot a red first, then a colour — alternating. Reds stay potted; colours are <b>re-spotted</b> on their spots. When the last red is potted, the match enters the <b>colour phase</b>: colours are cleared in fixed order yellow → green → brown → blue → pink → black.</p></div>' +
            '<div class="guide-block"><h3>Scoring &amp; the 147</h3><p>Reds 1 each; colours by their colour (yellow 2, green 3, brown 4, blue 5, pink 6, black 7). The theoretical maximum break is <b>147</b> = 15 × (red 1 + black 7) + colours 2+3+4+5+6+7 (= 120 + 27). Most clearing breaks land between 67 and 84.</p></div>' +
            '<div class="guide-block"><h3>Re-spotting</h3><p>Colours return to their own spot. If that spot is occupied, place the colour on the highest available spot along the same line. If none is free, the colour <b>stays potted</b> until the colour phase, when every colour is reset before the run-down. The black stays where it lies until its turn.</p></div>' +
            '<div class="guide-block"><h3>Free Ball</h3><p>After a foul the incoming player may <b>declare a free ball</b>: any non-red ball in contact is treated as a red for that shot. The contact itself scores the value of that colour (no extra point for the actual free ball). Mostly used to escape snookers when the cue ball is locked away from every red.</p></div>' +
            '<div class="guide-block"><h3>Fouls</h3><ul class="guide-list"><li>Cue ball pocketed</li><li>No ball struck</li><li>First contact wrong for the phase (colour in red phase, or wrong colour / red in colour phase)</li><li>After the shot no ball hits a rail and none is potted (except on the break)</li><li>Touching a ball with body, clothing or anything other than the cue tip</li><li>Double hit, both feet off the floor, or tip still in contact when cueing</li></ul><p class="about-text dim">Penalty: opponent scores the value of the highest colour (yellow 2 → black 7, so <b>at least 4</b> and at most 7) and takes the next visit. The offending player’s cue ball remains where it lies unless a free ball is involved.</p></div>' +
            '<div class="guide-block"><h3>Colour Sequence</h3><p>Once the last red is potted, colours are cleared in this order: <b>yellow 2 → green 3 → brown 4 → blue 5 → pink 6 → black 7</b>. Any miss / wrong contact in this phase is a foul and loses the break. Black is the final ball — whoever legally pots the black on the right ball and at the right time wins.</p></div>' +
            '<div class="guide-block"><h3>End of Frame</h3><p>A frame ends on one of three events: ① a player concedes, ② a natural clearance finishes the table (all reds + all colours cleared), or ③ a <b>“C&amp;B&amp;W”</b> type natural end — the striker commits a foul on what would otherwise be the last shot of the match (miss / scratch / wrong contact / no rail after no pot). The higher-score player wins. This offline build uses score-led natural-end; the in-game HUD always shows both totals.</p></div>',
        },
        threecushion: {
          title: "3-Cushion Rules",
          body:
            '<div class="guide-block"><h3>3-Cushion</h3><p>No pockets. The cue ball must hit a cushion at least three times before striking the other two balls to score 1 point. Continue after scoring; miss and the turn passes.</p></div>' +
            '<div class="guide-block"><h3>Fouls</h3><ul class="guide-list"><li>Second ball struck before the cue ball has hit a cushion three times</li><li>No ball hit</li></ul><p class="about-text dim">After a foul the turn passes to the opponent.</p></div>',
        },
      },
    },
  }

  // 中文 -> 英文 文本映射（同时用于 textContent 与 title/aria-label 等属性）。
  // 缺失项保持中文（优雅降级），不会报错。
  var TX = {
    "九球": "9-Ball",
    "八球": "8-Ball",
    "斯诺克": "Snooker",
    "三库开伦": "3-Cushion",
    "规则": "Rules",
    "自己练习": "Practice",
    "电脑 · 稳健": "CPU · Steady",
    "电脑 · 激进": "CPU · Aggressive",
    "外观定制": "Appearance",
    "环境场景": "Environment",
    "球杆主题": "Cue Theme",
    "台球桌颜色": "Table Color",
    "开始游戏": "Start Game",
    "操作介绍": "How to Play",
    "查看回放": "Replays",
    "游戏设置": "Settings",
    "室内": "Room",
    "沙滩": "Beach",
    "原始森林": "Forest",
    "雪山": "Snow Mountain",
    "足球场": "Soccer",
    "篮球场": "Basketball",
    "UFC八角笼": "UFC Octagon",
    "办公室": "Office",
    "网吧": "Cybercafe",
    "暂不可用": "Unavailable",
    "随台面": "Match Table",
    "屠龙斩": "Dragon Slayer",
    "青龙": "Azure Dragon",
    "小黄人": "Minions",
    "小猪佩奇": "Peppa Pig",
    "火麒麟": "Fire Qilin",
    "经典原木": "Classic Wood",
    "翡翠绿": "Emerald",
    "赤焰红": "Crimson",
    "蓝宝石": "Sapphire",
    "金辉": "Gold",
    "点击色块即可实时切换球桌周围的背景与氛围光":
      "Tap a swatch to switch the surroundings and ambient light in real time.",
    "「随台面」时球杆颜色跟随台球桌颜色；也可单独换成主题贴图":
      'With "Match Table" the cue colour follows the table; you can also pick a standalone themed texture.',
    "点击色块即可实时更换球台台呢与球杆外观":
      "Tap a swatch to change the cloth and cue appearance in real time.",
    "基本操作": "Basics",
    "旋转视角：在球桌上单指左右拖动":
      "Rotate view: drag one finger left/right on the table.",
    "调整镜头：单指上下拖动，抬高 / 降低机位": "Adjust camera: drag one finger up/down to raise or lower the viewpoint.",
    "缩放画面：切到「远台」视角后双指捏合缩放":
      "Zoom: switch to Far view, then pinch to zoom.",
    "击球：点击底部操作栏最左侧的「击球」按钮":
      'Shoot: tap the "Shoot" button at the far left of the bottom bar.',
    "力度：拖动底部栏的力度条设定击球力量，百分比实时显示；击球后力度条维持设定值，下一杆可直接沿用":
      "Power: drag the power bar to set strength; the percentage shows live. After shooting, the bar keeps its value for the next shot.",
    "加塞与杆法": "Spin & Stroke",
    "击球点：点底部操作栏的「击球点」按钮展开母球面板，在盘上点选或拖出落点——偏上为高杆（跟进）、偏下为低杆（缩杆）、左右为左右塞（加塞走位）":
      "Contact point: tap Contact on the bottom bar to open the cue-ball panel, then tap or drag a spot — top is follow, bottom is draw, left/right is side spin.",
    "抬杆角度：在面板右侧「抬杆高度」区拖动球杆，抬高杆尾角度，用于跳球或打出弧线":
      "Cue elevation: drag the cue in the Elevation area on the right of the panel to raise the butt angle for jump or curve shots.",
    "复位：点击面板左上角的 ⟲ 按钮，击球点立刻回到正中心":
      "Reset: tap the ⟲ button at the top-left of the panel to recentre the contact point.",
    "摆球（自由球）": "Ball-in-hand",
    "对手犯规或开局摆球时，用单指在台面上点击 / 拖动，把母球放到任意合法位置":
      "After a foul or when breaking, tap or drag on the table with one finger to place the cue ball anywhere legal.",
    "位置确定后点击「击球」按钮，进入瞄准":
      'Once placed, tap "Shoot" to aim.',
    "视角切换": "Camera",
    "点击底部操作栏的": "Tap the",
    "按钮循环切换：瞄准视角 → 俯视全局 → 远台":
      "button on the bottom bar to cycle: Aim → Top-down → Far.",
    "俯视视角便于观察整体球型和走位路线":
      "Top-down helps you read the whole table and plan position.",
    "远台视角可单指旋转、双指捏合缩放，看清整张球台与房间":
      "In Far view, drag to orbit and pinch to zoom to see the whole table and room.",
    "小技巧": "Tips",
    "击球前先切到俯视，规划好下一颗球的走位":
      "Before shooting, switch to top-down and plan the next ball position.",
    "低杆可让母球回撤，高杆使其跟进，善用可控制走位":
      "Draw pulls the cue ball back, follow pushes it forward — use them to control position.",
    "力度并非越大越好，很多球轻推反而更准":
      "More power is not always better; many shots are more accurate with a gentle push.",
    "力度 ≈ 60%": "Power ≈ 60%",
    "看完，开始游戏": "Got it, start game",
    "画面": "Graphics",
    "画质档位": "Quality",
    "自动检测推荐画质": "Auto-detect recommended quality",
    "重新检测": "Re-detect",
    "声音": "Sound",
    "音效开关": "Sound on/off",
    "音量": "Volume",
    "操作": "Controls",
    "球杆延长线": "Cue extension line",
    "进球预测线": "Pot prediction line",
    "辅助线长度": "Aim line length",
    "没有正对袋口时辅助线的延伸长度，拖到最左可关闭。":
      "How far the line extends when no pocket is directly aimed at; drag fully left to turn it off.",
    "保留三个视角": "Keep three views",
    "关闭后，": "When off, ",
    "只在「瞄准 / 俯视 / 远台」三档之间直接切换，不再自动拉远查看全台。":
      "the camera cycles directly between Aim / Top-down / Far without auto zooming out to show the whole table.",
    "训练": "Tutorial",
    "安装后首次进入对局（训练或对战）会自动显示一次分步引导，引导你实做「摆白球→瞄准→击球」。 引导走完后不再自动弹出，可随时点击下方按钮重新观看。":
      "The first time you enter a match (practice or versus) after install, a one-time step guide shows how to place the cue ball, aim and shoot. It will not reappear afterwards; tap the button below to watch it again.",
    "手动重看引导": "Re-watch guide manually",
    "重新打开新手引导": "Reopen tutorial",
    "电脑对战": "Versus CPU",
    "每回合时间限制": "Turn time limit",
    "仅电脑对战（稳健 / 激进 / 专业）生效。倒计时结束时若还没出杆，会自动按当前力度与瞄准方向出杆。":
      "Applies to all CPU modes (Steady / Aggressive / Pro). If time runs out before you shoot, the shot is taken automatically at the current power and aim.",
    "关于": "About",
    "本游戏为完全离线的单机版本，不需要联网、无任何广告、不收集任何个人信息。":
      "This game is a fully offline single-player version: no internet needed, no ads, and no personal data collected.",
    "本作品是开源项目 tailuge/billiards 的衍生作品，遵循 GPL-3.0 协议。 物理引擎实现了真实的球体碰撞、旋转、库边反弹与摩擦模型。":
      "This is a derivative of the open-source project tailuge/billiards under GPL-3.0. The physics engine implements realistic ball collisions, spin, cushion bounce and friction.",
    "本游戏不申请任何权限，不申请联网、存储、定位等任何敏感权限，因此无法自动检查更新。 如需获取最新版本，请自行前往 GitHub 的 Release 页面下载：":
      "This game requests no permissions — no network, storage or location — so it cannot auto-check for updates. To get the latest version, download it yourself from the GitHub Releases page:",
    "查看 GitHub Release 更新": "View GitHub Releases",
    "打开 GitHub 项目页": "Open GitHub project",
    "变更履历": "Changelog",
    "开源许可与致谢": "Open Source License & Credits",
    "恢复默认设置": "Reset to defaults",
    "返回": "Back",
    "原始项目": "Original project",
    "本作品是开源项目 tailuge/billiards 的衍生作品。":
      "This work is a derivative of the open-source project tailuge/billiards.",
    "项目": "Project",
    "作者": "Author",
    "协议": "License",
    "基线": "Base",
    "物理引擎、渲染管线、规则判定与电脑对手等核心实现均来自该项目， 版权归原作者及其贡献者所有。在此致谢。":
      "Core implementations — physics, render pipeline, rules and the CPU opponent — all come from that project; copyright belongs to the original authors and contributors. Thanks to them.",
    "项目地址：": "Project: ",
    "本衍生版源码：": "This derivative source: ",
    "修改声明": "Modification notice",
    "修改者": "Modified by",
    "衍生版本": "Derivative version",
    "修改日期": "Modified date",
    "本作品由 huang336 基于 tailuge/billiards 修改而来。 主要改动：全中文本地化、移除全部联网功能、新增六档画质系统与移动端适配、 新增操作介绍与设置面板、封装为安卓离线应用。":
      "This derivative was modified by huang336 based on tailuge/billiards. Key changes: full Chinese localization, removal of all networking, a six-tier quality system with mobile optimization, an added how-to-play and settings panel, and packaging as an offline Android app.",
    "协议义务": "License obligations",
    "本作品整体依据 GPL-3.0 发布。依据协议第 6 条， 分发二进制形式时须同时提供对应完整源代码， 该源码已随发布页附件一并提供。":
      "This work is released under GPL-3.0. Per section 6, distributing binaries requires providing the corresponding complete source code, which ships with the release page.",
    "你有权自由运行、研究、修改和再分发本作品， 但再分发时须遵循同样的 GPL-3.0 条款。 协议全文：gnu.org/licenses/gpl-3.0.html":
      "You are free to run, study, modify and redistribute this work, but redistributions must follow the same GPL-3.0 terms. Full text: gnu.org/licenses/gpl-3.0.html",
    "第三方组件": "Third-party components",
    "以上组件版权归各自作者所有，依 MIT 协议使用。":
      "The above components are copyrighted by their respective authors and used under the MIT license.",
    "无担保声明": "No warranty",
    "本程序不提供任何担保。在适用法律允许的最大范围内， 版权持有者以「原样」提供本程序，不作任何明示或默示的担保， 使用风险由你自行承担。":
      "This program comes with NO warranty. To the maximum extent permitted by law, the copyright holder provides it as is with no express or implied warranty; use it at your own risk.",
    "九球规则": "9-Ball Rules",
    "八球规则": "8-Ball Rules",
    "斯诺克规则": "Snooker Rules",
    "三库开伦规则": "3-Cushion Rules",
    "语言": "Language",
    "界面语言": "Interface language",
    "中文": "Chinese",
    "本应用自 v1.0.4（2026-08-03）起的全部版本变更记录，新版本置顶。详细条目可在每个版本下展开。":
      "All version changes since v1.0.4 (2026-08-03), newest first. Expand each version for details.",

    // v1.3.21 新增球杆主题 EN 名
    "奥特曼": "Ultraman",
    // v1.3.23 新增 12 款特色球杆皮肤 EN 名
    "墨云龙阙": "Moyun Longque",
    "青竹听风": "Qingzhu Tingfeng",
    "凤羽鎏金": "Fengyu Gilt",
    "千里砚山": "Qianli Inkstone",
    "星核暗芒": "Star Core",
    "霓虹溯光": "Neon Trace",
    "虚空裂隙": "Void Rift",
    "幽刺夜影": "Shadow Thorn",
    "烬火焚风": "Ember Blaze",
    "云糖幻梦": "Cloud Candy",
    "冰晶雪魄": "Ice Crystal",
    "万象权杖": "Myriad Scepter",

    // v1.3.21 新增桌布 EN 名
    "黑曜石黑": "Obsidian Black",
    "熔岩裂纹": "Lava Cracks",
    "霓虹蓝紫": "Neon Blue-Purple",
    "朱红鎏金": "Crimson Gold",
    "全息银": "Holographic Silver",
    "粉色糖果": "Pink Candy",
    // v1.3.61 新增桌布 EN 名
    "翡翠鎏金": "Emerald Gilded",
    "紫夜流光": "Violet Nightglow",

    // 操作介绍 / 关于 区块：被 <b> 等标签拆开后的单段片段
    "旋转视角": "Rotate view",
    "调整俯仰": "Tilt view",
    "缩放画面": "Zoom",
    "击球": "Shoot",
    "力度": "Power",
    "击球点": "Contact point",
    "抬杆角度": "Elevate cue",
    "复位": "Reset",
    "高杆": "Follow",
    "低杆": "Draw",
    "左塞": "Left",
    "右塞": "Right",
    "：在球桌上单指左右拖动": ": drag one finger left/right on the table.",
    "：单指上下拖动": ": drag one finger up/down.",
    "：双指捏合放大 / 缩小": ": pinch with two fingers to zoom in / out.",
    "：点击底部操作栏最左侧的「击球」按钮":
      ': tap the leftmost "Shoot" button on the bottom bar.',
    "：拖动底部栏的力度条设定击球力量，百分比实时显示；击球后力度条维持设定值，下一杆可直接沿用":
      ": drag the power bar to set strength; the percentage shows live. After shooting, the bar keeps its value for the next shot.",
    "：点开底部栏「击球点」展开母球圆盘，在盘上点选落点——偏上为高杆（跟进）、偏下为低杆（缩杆）、左右为左右塞（加塞走位）":
      ": open Contact on the bottom bar to reveal the cue-ball disc, then tap a spot — top is follow, bottom is draw, left/right is side spin.",
    "：在面板右侧「抬杆高度」区拖动球杆，抬高杆尾角度，用于跳球或打出弧线":
      ': drag the cue in the "Cue height" area on the right of the panel to raise the butt angle, for jump or curve shots.',
    "：点击面板左上角的 ⟲ 按钮，击球点立刻回到正中心":
      ": tap the ⟲ button at the top-left of the panel to recentre the contact point.",
    "（高杆": " (follow",
    "（跟进）": ")",
    "（低杆": " (draw",
    "（缩杆）": ")",
    "（左右": " (left/right",
    "（加塞走位）": ")",

    // 关于：被 <b> 拆开
    "本游戏为完全离线的单机版本，":
      "This game is a fully offline single-player version:",
    "不需要联网": "no internet needed",
    "、无任何广告、": ", no ads, ",
    "无任何广告": "no ads",
    "不收集任何个人信息。": "and no personal data collected.",
    "本作品是开源项目 ": "This is a derivative of the open-source project ",
    " 的衍生作品，遵循 GPL-3.0 协议。 物理引擎实现了真实的球体碰撞、旋转、库边反弹与摩擦模型。":
      " under GPL-3.0. The physics engine implements realistic ball collisions, spin, cushion bounce and friction.",
    "开发者": "Developer",
    "版本": "Version",
    "协议": "License",
    "项目源码": "Source",
    "上游项目": "Upstream",
    "本游戏": "This game",
    "不申请任何权限": "requests no permissions",
    "，不申请联网、存储、定位等任何敏感权限，因此无法自动检查更新。 如需获取最新版本，请自行前往 GitHub 的 Release 页面下载：":
      " — no network, storage or location — so it cannot auto-check for updates. To get the latest version, download it yourself from the GitHub Releases page:",
      "奥特曼的台球 · 离线版": "Ultraman Billiards · Offline Edition",
      "电脑 · 专业": "CPU · Pro",
      "点击色块即可实时更换台呢、桌框、纹理与边缘发光特效（球杆随台面自动协调）": "Tap a swatch to change the cloth, frame, texture and edge glow in real time (the cue follows the table automatically).",
      "最长": "Longest",
      "选择后会立即在主菜单高亮，进入对局即生效；对局中经本页或设置页更换也会实时刷新。": "Your selection is highlighted on the home screen immediately and takes effect when you enter a match; changes made here or in Settings also refresh live during a match.",
      "安装后首次进入对局（训练或对战）会自动显示一次分步引导，引导你实做「摆白球→瞄准→击球」。\n              引导走完后不再自动弹出，可随时点击下方按钮重新观看。": "After installation, the first time you enter a match (practice or versus) a one-time step-by-step tutorial appears, guiding you through “place the cue ball → aim → shoot”. It will not pop up again afterward; tap the button below to replay it anytime.",
      "无限制": "No limit",
      "10 秒": "10s",
      "20 秒": "20s",
      "30 秒": "30s",
      "不收集任何个人信息": "collects no personal information",
      "本作品是开源项目": "This work is an open-source project",
      "的衍生作品，遵循 GPL-3.0 协议。\n              物理引擎实现了真实的球体碰撞、旋转、库边反弹与摩擦模型。": "derived from tailuge/billiards, released under the GPL-3.0 license. Its physics engine implements realistic ball collision, spin, cushion rebound and friction models.",
      "，不申请联网、存储、定位等任何敏感权限，因此无法自动检查更新。\n              如需获取最新版本，请自行前往 GitHub 的 Release 页面下载：": ", and requests no sensitive permissions such as network, storage or location, so it cannot auto-check for updates. To get the latest version, download it yourself from the GitHub Releases page:",
      "的衍生作品。": " is a derivative work.",
      "物理引擎、渲染管线、规则判定与电脑对手等核心实现均来自该项目，\n              版权归原作者及其贡献者所有。在此致谢。": "The core implementations—physics engine, rendering pipeline, rule judgments and the computer opponent—all come from that project; copyright belongs to the original authors and contributors. Our thanks to them.",
      "2026 年 8 月 3 日": "August 3, 2026",
      "本作品由 huang336 基于 tailuge/billiards 修改而来。\n              主要改动：全中文本地化、移除全部联网功能、新增六档画质系统与移动端适配、\n              新增操作介绍与设置面板、封装为安卓离线应用。": "This edition was modified by huang336 based on tailuge/billiards. Key changes: full Chinese localization, removal of all networking features, a six-tier quality system plus mobile adaptation, an added How-to-Play guide and Settings panel, and packaging as an offline Android app.",
      "本作品整体依据 GPL-3.0 发布。依据协议第 6 条，\n              分发二进制形式时须同时提供对应完整源代码，\n              该源码已随发布页附件一并提供。": "This work is released under GPL-3.0. Per section 6 of the license, distributing binary forms requires also providing the corresponding complete source code, which is included with the release page attachments.",
      "你有权自由运行、研究、修改和再分发本作品，\n              但再分发时须遵循同样的 GPL-3.0 条款。\n              协议全文：gnu.org/licenses/gpl-3.0.html": "You are free to run, study, modify and redistribute this work, but redistribution must follow the same GPL-3.0 terms. Full text: gnu.org/licenses/gpl-3.0.html",
      "本程序不提供任何担保。在适用法律允许的最大范围内，\n              版权持有者以「原样」提供本程序，不作任何明示或默示的担保，\n              使用风险由你自行承担。": "This program comes with no warranty. To the maximum extent permitted by law, the copyright holders provide it “as is” with no express or implied warranty; use it at your own risk.",
      "还没有保存的回放。": "No saved replays yet.",
      "在每局结束后点击「保存回放」即可在此回看。": "After each match, tap “Save Replay” to review it here.",
  }

  function curLang() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var s = JSON.parse(raw)
        if (s && (s.language === "en" || s.language === "zh")) return s.language
      }
    } catch (e) {}
    return "zh"
  }

  function localePkg() {
    var l = curLang()
    return I18N[l] || I18N.zh
  }

  function QL(i) {
    var a = localePkg().quality
    return a[i] != null ? a[i] : I18N.zh.quality[i]
  }
  function QH(i) {
    var a = localePkg().qualityHint
    return a[i] != null ? a[i] : I18N.zh.qualityHint[i]
  }
  function TL(i) {
    var a = localePkg().tline
    return a[i] != null ? a[i] : I18N.zh.tline[i]
  }

  function setLang(l) {
    if (l !== "en" && l !== "zh") l = "zh"
    var s = {}
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) s = JSON.parse(raw) || {}
    } catch (e) {
      s = {}
    }
    s.language = l
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {}
  }

  // 本地化遍历：toLang==="en" 时按 TX 做中->英并记录原文；toLang==="zh" 时还原。
  function localize(root, toLang) {
    root = root || document
    try {
      document.documentElement.lang = toLang === "en" ? "en" : "zh-CN"
    } catch (e) {}
    if (!root.querySelectorAll) return
    var walker
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    } catch (e) {
      return
    }
    var texts = []
    var n
    while ((n = walker.nextNode())) texts.push(n)
    for (var i = 0; i < texts.length; i++) {
      var node = texts[i]
      if (node.nodeValue == null) continue
      if (toLang === "en") {
        var key = node.nodeValue.trim()
        if (TX[key] != null) {
          node.__zh = key
          node.nodeValue = TX[key]
        }
      } else if (node.__zh != null) {
        node.nodeValue = node.__zh
      }
    }
    var attrs = ["title", "aria-label", "placeholder", "alt"]
    var els = root.querySelectorAll("*")
    for (var j = 0; j < els.length; j++) {
      var el = els[j]
      for (var k = 0; k < attrs.length; k++) {
        var an = attrs[k]
        var v = el.getAttribute(an)
        if (v == null) continue
        if (toLang === "en") {
          if (TX[v] != null) {
            if (el["__zh_" + an] == null) el["__zh_" + an] = v
            el.setAttribute(an, TX[v])
          }
        } else if (el["__zh_" + an] != null) {
          el.setAttribute(an, el["__zh_" + an])
        }
      }
    }
  }

  // 兼容旧引用（仅中文默认），实际取值走 QL/QH/TL
  var QUALITY_LABELS = I18N.zh.quality
  var QUALITY_HINTS = I18N.zh.qualityHint
  var TLINE_LABELS = I18N.zh.tline

  /* v1.8.3：受支持的环境场景（足球场 / 篮球场 / UFC八角笼已下线） */
  var SCENE_IDS = ["room", "beach", "snow", "tea", "cell", "seed"]

  var DEFAULTS = {
    lod: 3,
    sound: true,
    // v1.2.28：音量默认最大（1.0）。与 settings.ts 对齐。
    volume: 1,
    aimAssist: true,
    seenGuide: false,
    turnTimer: 0,
    lastRule: "nineball",
    lastOpponent: "solo",
    // v1.3.65：局域网对战「加入房间」时上次输入的对方 IP（可带 :端口）
    lastLanHost: "",
    vsBot: false,
    fpsCap: 0,
    // v1.2.28：辅助线长度默认最长（3）。此前此处写 2（中）与 settings.ts 的 3 不一致，
    // 且菜单这份 DEFAULTS 会被持久化，导致首次进入游戏辅助线默认不是最长。统一为 3。
    targetLineLength: 3,
    aimLine: true,
    aimSlider: true,
    keepAllViews: true,
    skin: "classic",
    cueTheme: "auto",
    // v1.8.6：球桌外观只剩经典原木，默认值同步（旧存档由 settings.ts 归一）
    tableSkin: "classic",
    // v1.1.6：默认且仅启用「雪山」场景
    scene: "snow",
    // v1.3.19：界面语言默认中文
    language: "zh",
    // v1.8.7：界面主题（paper/felt/arcade），同时驱动首页与游戏内弹窗
    uiTheme: "paper",
  }
  var UI_THEMES = { paper: 1, felt: 1, arcade: 1 }

  /* ---------------- 设置存取 ---------------- */

  function loadSettings() {
    var s = {}
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) s = JSON.parse(raw) || {}
    } catch (e) {
      s = {}
    }
    var isFirst = !s || Object.keys(s).length === 0
    var merged = {}
    for (var k in DEFAULTS) merged[k] = DEFAULTS[k]
    for (var k2 in s) merged[k2] = s[k2]
    if (isFirst) merged.lod = detectLod()
    merged.lod = Math.min(5, Math.max(0, Math.round(merged.lod)))
    // v1.8.3：场景选择改为真正持久化。此前这里把任何非雪山场景强制改回
    // 雪山，导致「退出游戏再进又变回默认雪山」。现改为白名单校验：
    // 只拦已下线（football / basketball / ufc）或脏数据的旧存档，回落到雪山。
    if (SCENE_IDS.indexOf(merged.scene) < 0) merged.scene = "snow"
    // v1.8.7：界面主题白名单校验，脏数据回落 paper
    if (!UI_THEMES[merged.uiTheme]) merged.uiTheme = "paper"
    // v1.1.10：seenGuide 独立 key 兜底。主 key 写入失败时，独立 key 仍可读到。
    // v1.5.1：补齐第三通道 globalThis.__billiardsSeenGuide，与 Settings.hasSeenGuide()
    // 的三通道判定完全对齐 —— 游戏内引导完成时先写内存标记，主 key 落盘有可能
    // 因配额失败，缺这一通道会让菜单仍以为「没看过」而重复拼 tutorial=1。
    if (!merged.seenGuide && globalThis.__billiardsSeenGuide === true) {
      merged.seenGuide = true
    }
    if (!merged.seenGuide) {
      try {
        if (localStorage.getItem("billiards_cn_seenGuide_v1") === "1") {
          merged.seenGuide = true
        }
      } catch (e) { /* 忽略 */ }
    }
    return merged
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {
      // v1.1.10：不再静默吞错，至少把 seenGuide 写到独立 key 兜底
      console.warn("[menu] localStorage 写入失败", e)
      try {
        if (s && s.seenGuide) {
          localStorage.setItem("billiards_cn_seenGuide_v1", "1")
        }
      } catch (e2) { /* 彻底不可用时无能为力 */ }
    }
  }

  /**
   * v1.8.7：把界面主题应用到 <html>，首页与游戏内弹窗共用。
   * 同时写 data-ui-theme（共用 token）与 data-home-theme（首页专属 token）。
   * 注意：URL ?theme= 选稿参数优先级最高，若存在则不覆盖（选稿期间切设置不应被锁死，
   * 但刷新后 URL 参数仍会赢——这是选稿模式的设计意图）。
   */
  function applyUiTheme(t) {
    if (!UI_THEMES[t]) t = "paper"
    var root = document.documentElement
    root.setAttribute("data-ui-theme", t)
    root.setAttribute("data-home-theme", t)
  }

  /**
   * 主题按钮高亮。切换入口已收敛到「设置」页（唯一入口），
   * 这里仍按 data-theme-value 统一扫描，便于日后扩展其他入口。
   */
  function syncThemeButtons() {
    var btns = document.querySelectorAll("[data-theme-value]")
    // 高亮以「当前实际生效的主题」为准（head 脚本可能用 URL ?theme= 选稿，
    // 这时存档还是旧值，按钮必须跟着画面走，否则出现"画面是午夜、按钮亮米白"）
    var cur = ""
    try {
      cur = document.documentElement.getAttribute("data-ui-theme") || ""
    } catch (e) {}
    if (!UI_THEMES[cur]) cur = settings.uiTheme
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-theme-value") === cur
      if (on) {
        btns[i].classList.add("active")
        btns[i].setAttribute("aria-selected", "true")
      } else {
        btns[i].classList.remove("active")
        btns[i].setAttribute("aria-selected", "false")
      }
    }
  }

  /** 主题按钮绑定 —— 写存档 + 立即换肤 + 同步按钮高亮 */
  function initThemeButtons() {
    if (__themeBtnsBound) return
    __themeBtnsBound = true
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-theme-value]"),
      function (btn) {
        btn.addEventListener("click", function () {
          var v = btn.getAttribute("data-theme-value")
          if (!UI_THEMES[v]) return
          settings.uiTheme = v
          saveSettings(settings)
          applyUiTheme(v)
          syncThemeButtons()
          buzz(12)
        })
      }
    )
    syncThemeButtons()
  }

  /** 依据设备内存/核心数/GPU 推荐画质 */
  function detectLod() {
    try {
      var mem = navigator.deviceMemory || 4
      var cores = navigator.hardwareConcurrency || 4
      var dpr = window.devicePixelRatio || 1
      var score = 0
      if (mem >= 8) score += 3
      else if (mem >= 6) score += 2
      else if (mem >= 4) score += 1
      if (cores >= 8) score += 3
      else if (cores >= 6) score += 2
      else if (cores >= 4) score += 1
      if (dpr >= 2) score += 1

      var gpu = detectGpu().toLowerCase()
      var lowEnd = ["mali-4", "mali-t", "adreno 3", "adreno 4", "powervr sgx"]
      for (var i = 0; i < lowEnd.length; i++) {
        if (gpu.indexOf(lowEnd[i]) >= 0) {
          score -= 3
          break
        }
      }
      if (score >= 6) return 4
      if (score >= 4) return 3
      if (score >= 2) return 2
      return 1
    } catch (e) {
      return 2
    }
  }

  function detectGpu() {
    // 关键修复：菜单启动阶段【不再】创建 WebGL 上下文。
    // 原实现用裸 canvas.getContext("webgl") 读取 GPU 型号，但部分机型 GPU 驱动
    // 在创建这个上下文时会直接令渲染进程崩溃（表现即"点图标即闪退，进不了首页"）。
    // 画质自动分级改为仅依据 deviceMemory / 核数 / DPR，已知低端 GPU 的额外扣分在此跳过；
    // 用户仍可在设置中手动调低画质。游戏页（index.html）真正的 WebGL 由 three.js 负责，
    // 那里有 onRenderProcessGone 兜底，与菜单解耦。
    return ""
  }

  var settings = loadSettings()
  /** 主题按钮只绑定一次（设置页唯一入口） */
  var __themeBtnsBound = false

  /* ---------------- 界面状态 ---------------- */

  var selectedRule = settings.lastRule || "nineball"
  var selectedOpponent = settings.lastOpponent || "solo"
  // v1.8.8：打开局域网模态前选的是哪种对手，关闭时原样退回
  var lanPrevOpponent = selectedOpponent === "lan" ? "solo" : selectedOpponent

  function $(id) {
    return document.getElementById(id)
  }

  /* ---------------- 玩法选择 ---------------- */

  // 每个玩法的色板：与 CSS .mode-card 的 data-tint 对应，
  // 同时驱动「模式预览」画布的背景主题，让卡片整体色彩协调。
  var MODE_META = {
    nineball:     { tint: "#ffb648", icon: "assets/nineball.png",     name: "九球" },
    eightball:    { tint: "#3aa3ff", icon: "assets/eightball.png",    name: "八球" },
    snooker:      { tint: "#e85a5a", icon: "assets/snooker.png",      name: "斯诺克" },
    threecushion: { tint: "#7e5ad6", icon: "assets/threecushion.png", name: "三库开伦" },
  }

  function getModeMeta(rule) {
    return MODE_META[rule] || MODE_META.eightball
  }

  function initModes() {
    var cards = document.querySelectorAll(".mode-card")
    Array.prototype.forEach.call(cards, function (card) {
      var rule = card.getAttribute("data-rule")
      var meta = getModeMeta(rule)
      // 把 data-tint 转成 CSS 变量，让色彩主题在卡片各处生效
      card.style.setProperty("--tint", meta.tint)
      if (rule === selectedRule) {
        card.classList.add("selected")
      }
      // v1.2.11 #F4：外层改为 div，补 keydown 触发模式选择（可访问性）
      card.addEventListener("click", function (e) {
        // 若点击来自规则按钮，不触发模式选择
        if (e.target && e.target.classList && e.target.classList.contains("mode-rule")) return
        Array.prototype.forEach.call(cards, function (c) {
          c.classList.remove("selected")
        })
        card.classList.add("selected")
        selectedRule = rule
        settings.lastRule = selectedRule
        saveSettings(settings)
        updateOpponentAvailability()
        buzz(10)
      })
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault()
          card.click()
        }
      })
    })

    // v1.2.11 #F4：绑定「规则」按钮点击 → 弹出对应玩法规则
    var ruleBtns = document.querySelectorAll(".mode-rule")
    Array.prototype.forEach.call(ruleBtns, function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation()
        e.preventDefault()
        var rule = btn.getAttribute("data-rule")
        showModeRules(rule)
        buzz(10)
      })
    })
  }

  /** v1.2.11 #F4：各玩法规则文本（含犯规规则），填充到 #screen-rules。
   *  v1.3.19：规则文本改由 I18N[lang].modeRules 提供（见文件顶部），按语言切换。 */
  var currentRuleForLang = null

  function showModeRules(rule) {
    var info = (I18N[curLang()].modeRules || I18N.zh.modeRules)[rule]
    if (!info) return
    currentRuleForLang = rule
    var titleEl = $("rulesTitle")
    var bodyEl = $("rulesBody")
    if (titleEl) titleEl.textContent = info.title
    if (bodyEl) bodyEl.innerHTML = info.body
    showScreen("rules")
  }

  /**
   * 三库开伦没有袋口，电脑策略仅针对落袋类玩法，
   * 因此该玩法下只提供自己练习。
   */
  function updateOpponentAvailability() {
    var isCarom = selectedRule === "threecushion"
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      var op = b.getAttribute("data-opponent")
      // v1.3.65：局域网对战双方都是真人，与袋口无关，三库开伦同样可用；
      // 只有电脑档位（策略仅针对落袋类玩法）才需要在开伦下隐藏。
      var hide = isCarom && op !== "solo" && op !== "lan"
      b.style.display = hide ? "none" : ""
    })
    if (isCarom && selectedOpponent !== "solo" && selectedOpponent !== "lan") {
      selectOpponent("solo")
    }
  }

  function selectOpponent(op) {
    if (op === "lan" && selectedOpponent !== "lan") lanPrevOpponent = selectedOpponent
    selectedOpponent = op
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle("active", b.getAttribute("data-opponent") === op)
    })
    settings.vsBot = op !== "solo"
    settings.lastOpponent = op
    saveSettings(settings)
    updateLanPanel()
  }

  /* ---------------- v1.3.65：局域网对战面板 ----------------
     选「局域网对战」时展开：建房（本机做服务端、自己先开球）或
     输入对方 IP 加入。两台手机需连在同一个 Wi-Fi。 */

  function updateLanPanel() {
    var p = $("lanPanel")
    if (!p) return
    p.hidden = selectedOpponent !== "lan"
    // v1.8.8：面板是 fixed 居中模态，而 .sec-opponent 的入场动画
    // （hrRise + fill-mode:both）会留下 transform，从而把 fixed 的包含块
    // 变成这个 section 本身 —— 必须同时清掉它，否则面板只按 section
    // 的高度（约 50px）定位，被压成一条窄边。
    var sec = p.closest ? p.closest(".sec-opponent") : null
    if (sec) sec.classList.toggle("lan-open", !p.hidden)
    if (!p.hidden) {
      var inp = $("lanPeerInput")
      if (inp && !inp.value && settings.lastLanHost) {
        inp.value = settings.lastLanHost
      }
    }
  }

  // v1.3.73：局域网地址格式校验，支持 "192.168.1.5" 与 "192.168.1.5:24816"。
  // 只做格式校验（连不连得上是进游戏之后的事，由 LanRelay 的状态机负责反馈）。
  function isLanAddress(s) {
    var host = s
    var port = ""
    var i = s.lastIndexOf(":")
    if (i >= 0) {
      host = s.substring(0, i)
      port = s.substring(i + 1)
    }
    if (port !== "") {
      if (!/^\d{1,5}$/.test(port)) return false
      var p = parseInt(port, 10)
      if (p < 1 || p > 65535) return false
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
    var parts = host.split(".")
    for (var k = 0; k < parts.length; k++) {
      if (parseInt(parts[k], 10) > 255) return false
    }
    return true
  }

  function startLan(role) {
    var params = ["ruletype=" + encodeURIComponent(selectedRule)]
    if (role === "join") {
      var raw = ($("lanPeerInput") && $("lanPeerInput").value) || ""
      var ip = raw.trim()
      if (!ip) {
        showToast("请输入对方的地址")
        focusLanInput()
        return
      }
      // v1.3.73：进游戏前先做格式校验。此前只要非空就放行，随手填的
      // "123"、"abc" 也会跳进对局页，到里面连不上又没有任何反馈（v1.3.73
      // 之前连失败提示都会被常驻弹窗吞掉），表现就是"进入游戏后无反应"。
      // 在这里拦下最省事，用户当场就能改。
      if (!isLanAddress(ip)) {
        showToast("地址格式不正确，应形如 192.168.1.8")
        markLanInputInvalid(true)
        focusLanInput()
        return
      }
      settings.lastLanHost = ip
      saveSettings(settings)
      params.push("lan=join")
      params.push("peer=" + encodeURIComponent(ip))
    } else {
      params.push("lan=host")
    }
    // 联机不弹分步实操新手引导（会挡住双方的等待提示）
    location.replace("play.html?" + params.join("&"))
  }

  /* v1.3.93：局域网输入框的即时校验。
     旧版只在点「加入」时才校验一次，填错要点了才知道。现在边输边提示，
     并把提示文字染成对应颜色，用户不需要试错。
     **只做提示，不拦截输入** —— 校验规则与 startLan 里用的是同一个
     isLanAddress，不会出现"提示说没问题但点进去报错"的不一致。 */
  function markLanInputInvalid(bad) {
    var inp = $("lanPeerInput")
    if (inp) inp.classList.toggle("is-invalid", !!bad)
  }

  function focusLanInput() {
    try {
      var inp = $("lanPeerInput")
      if (inp) inp.focus()
    } catch (e) {}
  }

  function updateLanPeerHint() {
    var inp = $("lanPeerInput")
    var hint = $("lanPeerHint")
    if (!inp || !hint) return
    var v = (inp.value || "").trim()
    // 清掉上一次的上色，后面按新内容重设
    hint.classList.remove("is-warn", "is-ok")
    markLanInputInvalid(false)
    if (!v) {
      hint.textContent = "填写对方建房时显示的那串地址（含冒号后的端口）。"
      return
    }
    if (isLanAddress(v)) {
      hint.textContent = "地址格式没问题，点「加入」即可。"
      hint.classList.add("is-ok")
      return
    }
    hint.textContent = "格式不对：应为类似 192.168.1.8 或 192.168.1.8:24816。"
    hint.classList.add("is-warn")
    markLanInputInvalid(true)
  }

  /* v1.3.93：按钮防连点。点一下即置灰，直到页面跳转。
     「创建房间 / 加入」都会立刻 location.href 跳走，但跳转前有几十毫秒的
     空档，连点会重复触发 startLan（重复拼 URL、重复调 buzz）。
     这里在点击瞬间锁住按钮，配合 CSS 的 [data-busy] 视觉反馈。 */
  function lockLanButton(btn) {
    if (!btn || btn.dataset.busy === "1") return false
    btn.dataset.busy = "1"
    btn.setAttribute("disabled", "disabled")
    return true
  }

  function initLanPanel() {
    var hb = $("lanHostBtn")
    if (hb) {
      hb.addEventListener("click", function () {
        if (!lockLanButton(hb)) return
        buzz(10)
        startLan("host")
      })
    }
    var jb = $("lanJoinBtn")
    if (jb) {
      jb.addEventListener("click", function () {
        if (!lockLanButton(jb)) return
        buzz(10)
        startLan("join")
        // startLan 校验失败会原地返回（不跳转），此时必须解锁，
        // 否则按钮永久置灰，用户改完地址也点不动。
        jb.dataset.busy = ""
        jb.removeAttribute("disabled")
      })
    }
    var inp = $("lanPeerInput")
    if (inp) {
      inp.addEventListener("input", updateLanPeerHint)
      inp.addEventListener("change", updateLanPeerHint)
      // 回车 = 点「加入」，省一次点击
      inp.addEventListener("keydown", function (e) {
        if (e && e.key === "Enter") {
          e.preventDefault()
          if (jb) jb.click()
        }
      })
    }
    // v1.8.8：面板改为居中模态后必须有显式关闭入口 —— 否则遮罩盖住
    // 「自己练习 / 电脑对战」等选项，用户想取消都没地方点。
    // 关闭 = 退回上一次真正选中的对手（默认自己练习）。
    var cb = $("lanClose")
    if (cb) {
      cb.addEventListener("click", function () {
        selectOpponent(lanPrevOpponent || "solo")
        buzz(6)
      })
    }
    updateLanPeerHint()
    updateLanPanel()
  }

  function initOpponents() {
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        selectOpponent(b.getAttribute("data-opponent"))
        buzz(10)
      })
    })
    selectOpponent(selectedOpponent)
    updateOpponentAvailability()
  }

  /* ---------------- 屏幕切换 ---------------- */

  // v1.5.0：变更履历懒注入。首次点击时动态加载 changelog-data.js（约 298KB），
  // 注入 #changelogBody 后标记 data-filled，之后点击直接复用（不重复加载）。
  // 加载失败时给出可读提示，履历屏仍可打开（不至于白屏）。
  function injectChangelog(done) {
    var box = $("changelogBody")
    if (!box) { done(); return }
    if (box.getAttribute("data-filled") === "1") { done(); return }
    var inject = function () {
      try {
        box.innerHTML = window.__CHANGELOG_HTML || '<p class="about-text dim">履历内容缺失。</p>'
        box.setAttribute("data-filled", "1")
      } catch (e) {}
      done()
    }
    if (window.__CHANGELOG_HTML) { inject(); return }
    var sc = document.createElement("script")
    sc.src = "changelog-data.js"
    sc.onload = inject
    sc.onerror = function () {
      try {
        box.innerHTML = '<p class="about-text dim">变更履历加载失败，请退出应用后重试。</p>'
        box.setAttribute("data-filled", "1")
      } catch (e) {}
      done()
    }
    document.body.appendChild(sc)
  }

  /**
   * v1.5.1：菜单子屏历史栈 —— 让 Android 系统返回键在菜单内逐层回退。
   *
   * 背景（本版修复的真实缺陷）：菜单是单页应用，showScreen 只切 CSS class，
   * 所有子屏（设置 / 变更履历 / 关于 / 规则…）**都不往 history 里压条目**。
   * 于是 WebView 侧的 `canGoBack() ? goBack() : finish()` 完全取决于「上一个
   * 文档是谁」：冷启动时为 false（返回键直接退出应用）；而从对局页导航回来
   * 时历史栈里还留着 play.html，返回键会一路退回 play.html —— 用户看到的就是
   * 「在变更履历里按返回，却直接开始游戏」。
   *
   * 修法：每进一个子屏压一条 history；返回按钮与系统返回键都走 history.back()，
   * 由 popstate 统一把 UI 退回父屏。退回主屏后历史指针回到 menu.html 那一条，
   * 再按返回 canGoBack() 为 false，行为回到「主菜单按返回 = 退出应用」。
   */
  var screenStack = []
  var currentScreen = ""
  /**
   * v1.5.1：抑制**下一次** popstate 的子屏回退。
   * 球杆全屏预览关闭时会自己 history.back() 一次来清掉它压的那条历史；
   * 那次 back 同样会走到下面的 popstate 处理里，若不拦住就会连带多退一级
   * 子屏（表现为「关掉预览后设置页也跟着退回主页」）。
   */
  var screenSuppressPop = false
  /**
   * v1.8.8：抑制**下一次** popstate —— 这是「返回」按钮自己为了对齐历史而
   * 触发的 history.back()，UI 早已切好，绝不能让它再退一级。
   */
  var popQuiet = false
  var popQuietTimer = null

  // 初始屏由 HTML 里的 class="screen active" 决定（脚本不负责首屏渲染），
  // 这里必须同步进来：否则首次 showScreen 会把空串压进栈，返回时 pop 出空串
  // 会切到一个不存在的屏 —— 表现为整屏空白。
  ;(function () {
    try {
      var init = document.querySelector(".screen.active")
      currentScreen = init ? String(init.id || "").replace(/^screen-/, "") : "home"
    } catch (e) {
      currentScreen = "home"
    }
  })()

  /** 只切 UI，不动 history */
  function applyScreen(name) {
    var screens = document.querySelectorAll(".screen")
    Array.prototype.forEach.call(screens, function (s) {
      s.classList.remove("active")
    })
    var target = $("screen-" + name)
    if (target) target.classList.add("active")
    currentScreen = name
  }

  function showScreen(name) {
    if (!name || name === currentScreen) {
      applyScreen(name || "home")
      return
    }
    try {
      history.pushState({ menuScreen: name }, "", location.href)
    } catch (e) {
      // 极端 WebView 不支持 pushState：只是没有系统返回键兜底，UI 照常
    }
    // v1.8.8：UI 栈无条件记录 —— 旧实现把 push 放在 pushState 的同一 try 里，
    // pushState 一抛异常（file:// 或受限 WebView）栈就是空的，直接导致
    // 「返回按钮落回 fallback 也退不出去」。
    screenStack.push(currentScreen)
    applyScreen(name)
  }

  /**
   * 返回按钮 / 系统返回键共用的回退入口。
   *
   * v1.8.8 重写：**先同步切 UI，再尽力对齐 history**。
   * 旧实现是「有栈就 history.back() 然后 return」—— 把返回这件事完全押在
   * 浏览器历史与 popstate 上。真机 WebView 里 pushState 可能被拒、popstate 可能
   * 被别的 SPA 逻辑消费，任何一环不成立，用户看到的就是「点了返回没反应」。
   * 现在 UI 切换是同步且无条件的，返回 100% 有效；历史只用于让系统返回键与
   * 按钮保持同一层级。
   */
  function goBackScreen(fallback) {
    var target = screenStack.length > 0 ? screenStack.pop() : (fallback || "home")
    if (!target || target === currentScreen) target = fallback || "home"
    if (!target || target === currentScreen) return false
    applyScreen(target)
    alignHistoryBack()
    return true
  }

  /** 点返回后把浏览器历史指针也退一格（仅在当前条目确实是本页压的子屏条目时） */
  function alignHistoryBack() {
    var pushed = false
    try {
      pushed = !!(history.state && history.state.menuScreen)
    } catch (e) {}
    if (!pushed) return
    popQuiet = true
    if (popQuietTimer) clearTimeout(popQuietTimer)
    // 700ms 后强制复位：某些 WebView 的历史栈为空时不会派发 popstate，
    // 标记若一直留着，下一次系统返回键会被错误地忽略一次。
    popQuietTimer = setTimeout(function () {
      popQuiet = false
      popQuietTimer = null
    }, 700)
    try {
      history.back()
    } catch (e) {
      popQuiet = false
    }
  }

  window.addEventListener("popstate", function () {
    // 预览关闭时自行触发的那次 back：只消费掉，不做子屏回退
    if (screenSuppressPop) {
      screenSuppressPop = false
      return
    }
    // 点「返回」按钮时 alignHistoryBack() 自己触发的那次 back：UI 已经切好了，
    // 这里只把标记吃掉，绝不能再退一级。
    if (popQuiet) {
      popQuiet = false
      if (popQuietTimer) {
        clearTimeout(popQuietTimer)
        popQuietTimer = null
      }
      return
    }
    // 球杆全屏预览自己也压过一条历史，且它比子屏更"上层"，优先交给它处理，
    // 否则一次返回会同时关掉预览并多退一级屏。
    try {
      if (typeof cueOverlay !== "undefined" && cueOverlay &&
          cueOverlay.classList.contains("active")) {
        return
      }
    } catch (e) { /* cueOverlay 尚未初始化 */ }
    var prev = screenStack.pop()
    // 双重保险：栈里理论上不会存空串 / 未知屏，但真机上 WebView 的 popstate
    // 时机偶发异常（如快速连按返回），兜底回 home 也不能白屏。
    if (prev == null || prev === "") prev = "home"
    if (prev !== currentScreen) applyScreen(prev)
  })

  /**
   * v1.8.8：供 Android 端 onBackPressed() 调用的菜单返回入口。
   *
   * 返回 true 表示「页面自己处理了这次返回」（预览已关 / 子屏已回退），
   * Java 侧必须据此**只在这时**吞掉返回键；返回 false 才允许走
   * canGoBack()/退出应用。旧实现 Java 无条件吞键，一旦 JS 没接住，
   * 系统返回键在整个应用里就彻底失灵。
   */
  window.__onMenuBack = function () {
    try {
      if (typeof cueOverlay !== "undefined" && cueOverlay &&
          cueOverlay.classList.contains("active")) {
        closeCuePreviewOverlay()
        return true
      }
    } catch (e) { /* 预览未初始化 */ }
    if (screenStack.length > 0) return goBackScreen("home")
    return false
  }

  /* ---------------- 设置面板 ---------------- */

  function renderQualityOptions() {
    var sel = $("setQuality")
    if (!sel) return
    sel.innerHTML = ""
    for (var i = 0; i < 6; i++) {
      var opt = document.createElement("option")
      opt.value = String(i)
      opt.textContent = QL(i)
      sel.appendChild(opt)
    }
  }

  function initSettingsPanel() {
    renderQualityOptions()

    // v1.8.7：主题由 head 内联脚本在页面加载时写入 <html>（URL ?theme= 优先），
    // 此处只同步按钮高亮，绝不调用 applyUiTheme —— 否则会用存档值覆盖选稿参数。
    syncSettingsUI()

    // v1.3.60：画质档位 / 语言两组设置已从设置面板移除（见 menu.html），
    // 对应的 DOM 也不复存在。这里必须判空后再绑定，否则 null.addEventListener
    // 会抛 TypeError，把 initSettingsPanel 整段打断 —— 后面的音效 / 音量 /
    // 瞄准线等控件全都绑不上，设置面板等于废掉。
    var qSel = $("setQuality")
    if (qSel) {
      qSel.addEventListener("change", function () {
        settings.lod = parseInt(this.value, 10)
        saveSettings(settings)
        if ($("qualityHint")) $("qualityHint").textContent = QH(settings.lod)
      })
    }

    var autoQ = $("btnAutoQuality")
    if (autoQ) {
      autoQ.addEventListener("click", function () {
        settings.lod = detectLod()
        saveSettings(settings)
        syncSettingsUI()
        buzz(15)
      })
    }

    $("setSound").addEventListener("change", function (e) {
      settings.sound = e.target.checked
      saveSettings(settings)
    })

    $("setVolume").addEventListener("input", function (e) {
      settings.volume = parseInt(e.target.value, 10) / 100
      $("volumeVal").textContent = e.target.value + "%"
      saveSettings(settings)
    })

    $("setAim").addEventListener("change", function (e) {
      settings.aimAssist = e.target.checked
      saveSettings(settings)
    })

    $("setAimLine").addEventListener("change", function (e) {
      settings.aimLine = e.target.checked
      saveSettings(settings)
    })

    $("setTLine").addEventListener("input", function (e) {
      settings.targetLineLength = parseInt(e.target.value, 10)
      $("setTLineVal").textContent = TL(settings.targetLineLength) || "中"
      saveSettings(settings)
    })

    $("setKeepViews").addEventListener("change", function (e) {
      settings.keepAllViews = e.target.checked
      saveSettings(settings)
    })

// v1.3.59：移除 setCueTheme / setScene 的监听 —— 「外观与场景」整组已从游戏设置
// 移除（台球桌外观 v1.3.58 已删），三项外观设置统一在首页「外观定制」里改。
// 若保留此段，$("setCueTheme") 为 null 会在初始化时直接抛错导致菜单白屏。

    $("setTurnTimer").addEventListener("change", function (e) {
      settings.turnTimer = parseInt(e.target.value, 10) || 0
      saveSettings(settings)
    })

    // 主题按钮绑定（见 initThemeButtons）

    $("btnReset").addEventListener("click", function () {
      var d = {}
      for (var k in DEFAULTS) d[k] = DEFAULTS[k]
      d.lod = detectLod()
      settings = d
      saveSettings(settings)
      // v1.8.7：重置也要把主题应用回默认 paper
      applyUiTheme(settings.uiTheme)
      syncSettingsUI()
      buzz(20)
    })
  }

  function syncSettingsUI() {
    // v1.3.60：画质档位控件已随「画面」整组移除，判空后再写（同 initSettingsPanel）
    var qSel = $("setQuality")
    if (qSel) qSel.value = String(settings.lod)
    if ($("qualityHint")) $("qualityHint").textContent = QH(settings.lod)
    $("setSound").checked = !!settings.sound
    $("setVolume").value = String(Math.round(settings.volume * 100))
    $("volumeVal").textContent = Math.round(settings.volume * 100) + "%"
    $("setAim").checked = !!settings.aimAssist
    $("setAimLine").checked = settings.aimLine !== false
    $("setTLine").value = String(settings.targetLineLength || 3)
    $("setTLineVal").textContent = TL(settings.targetLineLength || 3) || "中"
$("setKeepViews").checked = settings.keepAllViews !== false
// v1.3.59：$("setCueTheme") / $("setScene") 已随「外观与场景」整组从游戏设置移除，
// 此处同步删除赋值。这两行原本没有 null 保护，只删 HTML 不删 JS 会启动即抛错白屏。
    $("setTurnTimer").value = String(settings.turnTimer || 0)
    // v1.8.8：同步全部主题入口的选中态（设置 / 局域网 / 游戏内）
    syncThemeButtons()
  }

  function buzz(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms)
    } catch (e) {
      /* 部分设备不支持震动 */
    }
  }

  /* ---------------- 选项框特写预览（item 5） ----------------
   * 用 Canvas 程序化生成「主题细节特写」，替代原来的纯色色块：
   *  - 场景：房间内景（墙面渐变 + 地面透视 + 各场景图案）
   *  - 球杆：斜放球杆特写（杆身渐变 + 铜箍皮头 + 主题纹样）
   *  - 台球桌颜色：台呢 + 木框 + 一颗球 的特写
   * 全部离线生成，结果以 dataURL 写入 .skin-swatch 的 background-image。
   */

  function shadeColor(hex, amt) {
    var c = String(hex).replace("#", "")
    if (c.length === 3)
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
    var r = parseInt(c.substr(0, 2), 16)
    var g = parseInt(c.substr(2, 2), 16)
    var b = parseInt(c.substr(4, 2), 16)
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(v + 255 * amt)))
    }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")"
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function makeCanvas(w, h) {
    var cv = document.createElement("canvas")
    cv.width = w
    cv.height = h
    return cv
  }

  function drawScenePreview(cv, kind, c1, c2) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, c1)
    g.addColorStop(1, c2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    var fh = H * 0.36
    ctx.fillStyle = shadeColor(c2, -0.16)
    ctx.fillRect(0, H - fh, W, fh)
    var vpx = W / 2,
      vpy = H - fh
    ctx.strokeStyle = "rgba(255,255,255,0.16)"
    ctx.lineWidth = 1
    for (var i = 0; i <= 6; i++) {
      var x = (i / 6) * W
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(vpx + (x - vpx) * 0.28, vpy)
      ctx.stroke()
    }
    for (var j = 1; j < 3; j++) {
      var y = vpy + (H - vpy) * (j / 3)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
    drawScenePattern(ctx, W, H, kind, c1, c2, vpy)
  }

  /**
   * 实景照片 cover 绘制（Request D）：把照片按 object-fit:cover 裁切填满画布，
   * 并叠加轻微暗角提升文字可读性。用于「雪山/足球场/篮球场」等照片场景缩略图。
   */
  function drawPhotoCover(cv, img) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var iw = img.width || 1,
      ih = img.height || 1
    var ir = iw / ih,
      cr = W / H
    var sx, sy, sw, sh
    if (ir > cr) {
      sh = ih
      sw = sh * cr
      sx = (iw - sw) / 2
      sy = 0
    } else {
      sw = iw
      sh = sw / cr
      sx = 0
      sy = (ih - sh) / 2
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.72)
    vg.addColorStop(0, "rgba(0,0,0,0)")
    vg.addColorStop(1, "rgba(0,0,0,0.2)")
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
  }

  function drawScenePattern(ctx, W, H, kind, c1, c2, horizonY) {
    switch (kind) {
      case "beach":
        ctx.globalAlpha = 0.12
        ctx.fillStyle = "#000"
        for (var y = 0; y < horizonY; y += 22)
          ctx.fillRect(0, y + ((y / 22) % 2 ? 5 : 0), W, 5)
        ctx.globalAlpha = 1
        break
      case "snow":
        ctx.fillStyle = "rgba(255,255,255,0.55)"
        for (var s = 0; s < 140; s++) {
          ctx.beginPath()
          ctx.arc(
            Math.random() * W,
            Math.random() * horizonY,
            Math.random() * 2 + 0.5,
            0,
            6.283
          )
          ctx.fill()
        }
        break
      case "football":
        ctx.fillStyle = "rgba(0,0,0,0.10)"
        for (var y4 = 0; y4 < horizonY; y4 += 26) ctx.fillRect(0, y4, W, 13)
        ctx.globalAlpha = 0.92
        ctx.strokeStyle = "#fff"
        ctx.lineWidth = 5
        ctx.strokeRect(16, 16, W - 32, horizonY - 32)
        ctx.beginPath()
        ctx.moveTo(16, horizonY / 2)
        ctx.lineTo(W - 16, horizonY / 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(W / 2, horizonY / 2, 52, 0, 6.283)
        ctx.stroke()
        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.arc(W / 2, horizonY / 2, 6, 0, 6.283)
        ctx.fill()
        ctx.globalAlpha = 1
        break
      case "basketball":
        ctx.globalAlpha = 0.06
        ctx.strokeStyle = "#3a230c"
        ctx.lineWidth = 2
        for (var x4 = 18; x4 < W; x4 += 34) {
          ctx.beginPath()
          ctx.moveTo(x4, 0)
          ctx.lineTo(x4, horizonY)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.95
        ctx.strokeStyle = "#fff4e0"
        ctx.lineWidth = 5
        ctx.strokeRect(16, 16, W - 32, horizonY - 32)
        ctx.strokeRect(W / 2 - 46, 16, 92, 96)
        ctx.fillStyle = "#fff4e0"
        ctx.beginPath()
        ctx.arc(W / 2, 112, 6, 0, 6.283)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(W / 2, 112, 98, 0.2 * Math.PI, 0.8 * Math.PI)
        ctx.stroke()
        ctx.globalAlpha = 1
        break
      case "ufc":
        // v1.3.65：UFC 八角笼缩略图 —— 暗场馆里一个八角形笼 + 笼网竖线
        ctx.globalAlpha = 0.1
        ctx.strokeStyle = "#585e68"
        ctx.lineWidth = 2
        for (var x5 = 10; x5 < W; x5 += 24) {
          ctx.beginPath()
          ctx.moveTo(x5, 0)
          ctx.lineTo(x5, horizonY)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.85
        ctx.strokeStyle = "#6a7280"
        ctx.lineWidth = 5
        ctx.beginPath()
        for (var k = 0; k <= 8; k++) {
          var a = k * (Math.PI / 4) + Math.PI / 8
          var rx = W / 2 + Math.cos(a) * Math.min(W, horizonY) * 0.34
          var ry = horizonY / 2 + Math.sin(a) * Math.min(W, horizonY) * 0.34
          if (k === 0) ctx.moveTo(rx, ry)
          else ctx.lineTo(rx, ry)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
        break
      case "room":
      default:
        ctx.globalAlpha = 0.06
        ctx.fillStyle = "#000"
        for (var y5 = 0; y5 < horizonY; y5 += 54) ctx.fillRect(0, y5, W, 2)
        ctx.globalAlpha = 1
        break
    }
  }

  function drawCueMotif(ctx, kind, halfLen, halfTh) {
    var x0 = -halfLen * 0.5,
      x1 = halfLen * 0.5
    ctx.save()
    if (kind === "auto") {
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = "rgba(255,255,255,0.5)"
      ctx.lineWidth = 1.5
      for (var i = -halfTh + 3; i < halfTh; i += 4) {
        ctx.beginPath()
        ctx.moveTo(x0, i + 1)
        ctx.lineTo(x1, i + 1 + (i % 8 ? 1 : -1))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "dragon") {
      ctx.strokeStyle = "#ffd76a"
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.9
      for (var d = 0; d < 5; d++) {
        var cx = x0 + 10 + d * ((x1 - x0) / 5)
        ctx.beginPath()
        ctx.arc(cx, 0, halfTh * 0.9, Math.PI * 0.15, Math.PI * 0.85)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "azure") {
      ctx.strokeStyle = "#9af0ff"
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.85
      for (var w = 0; w < 4; w++) {
        var yy = -halfTh + w * (halfTh * 0.6)
        ctx.beginPath()
        ctx.moveTo(x0, yy)
        ctx.quadraticCurveTo((x0 + x1) / 2, yy - 6, x1, yy)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "minions") {
      ctx.fillStyle = "#1f6fb2"
      roundRect(ctx, x0, -halfTh * 0.7, x1 - x0, halfTh * 1.4, halfTh * 0.7)
      ctx.fill()
      ctx.fillStyle = "#0d3b5a"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2, 0, halfTh * 0.5, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = "#9af0ff"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 - 2, -2, halfTh * 0.22, 0, 6.283)
      ctx.fill()
    } else if (kind === "peppa") {
      ctx.fillStyle = "#ff5e9a"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2, 0, halfTh * 0.7, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = "#ffd0e2"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 - 6, -3, halfTh * 0.22, 0, 6.283)
      ctx.fill()
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 + 6, -3, halfTh * 0.22, 0, 6.283)
      ctx.fill()
    } else if (kind === "moyunlongque") {
      ctx.strokeStyle = "#e6c878"
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 2
      for (var ml = -halfTh + 2; ml < halfTh; ml += 5) {
        ctx.beginPath()
        ctx.moveTo(x0, ml)
        ctx.lineTo(x1, ml + (ml % 10 ? 2 : -2))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "qingzhutingfeng") {
      ctx.strokeStyle = "rgba(225,245,220,0.7)"
      ctx.lineWidth = 1.5
      for (var qz = 0; qz < 4; qz++) {
        var qy = -halfTh + qz * (halfTh * 0.7)
        ctx.beginPath()
        ctx.moveTo(x0, qy)
        ctx.lineTo(x1, qy)
        ctx.stroke()
      }
    } else if (kind === "fengyuliujin") {
      ctx.strokeStyle = "#caa24a"
      ctx.lineWidth = 2
      for (var fy = 0; fy < 4; fy++) {
        ctx.beginPath()
        ctx.ellipse((x0 + x1) / 2, -halfTh + fy * (halfTh * 0.7), halfTh * 0.45, halfTh * 0.7, 0.3, 0, 6.283)
        ctx.stroke()
      }
    } else if (kind === "qianliyanshan") {
      ctx.strokeStyle = "rgba(30,40,45,0.7)"
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x0, halfTh * 0.2)
      ctx.lineTo((x0 + x1) / 2, -halfTh * 0.3)
      ctx.lineTo(x1, halfTh * 0.1)
      ctx.stroke()
    } else if (kind === "xinghedanmang") {
      ctx.fillStyle = "rgba(180,210,255,0.9)"
      for (var xh = 0; xh < 30; xh++) {
        ctx.fillRect(x0 + Math.random() * (x1 - x0), -halfTh + Math.random() * halfTh * 2, 1.5, 1.5)
      }
    } else if (kind === "nihongsuguang") {
      ctx.strokeStyle = "rgba(255,123,224,0.9)"
      ctx.lineWidth = 3
      ctx.beginPath()
      for (var nt = 0; nt <= 1; nt += 0.1) {
        var nx = (x0 + x1) / 2 + Math.sin(nt * 6) * (halfTh * 0.8)
        var ny = -halfTh + nt * halfTh * 2
        nt === 0 ? ctx.moveTo(nx, ny) : ctx.lineTo(nx, ny)
      }
      ctx.stroke()
    } else if (kind === "xukonglilie") {
      ctx.strokeStyle = "rgba(155,92,255,0.9)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x0, 0)
      for (var xk = 0; xk < 8; xk++) {
        ctx.lineTo(x0 + (x1 - x0) * (xk + 1) / 8, (xk % 2 ? 1 : -1) * halfTh * 0.7)
      }
      ctx.stroke()
    } else if (kind === "youciyeying") {
      ctx.fillStyle = "rgba(184,160,216,0.7)"
      for (var yc = -halfTh + 4; yc < halfTh; yc += 12) {
        ctx.beginPath()
        ctx.moveTo(x0 + 10, yc + 6)
        ctx.lineTo(x0 + 18, yc)
        ctx.lineTo(x0 + 26, yc + 6)
        ctx.closePath()
        ctx.fill()
      }
    } else if (kind === "jinhuofengfeng") {
      ctx.fillStyle = "rgba(255,122,31,0.9)"
      for (var jh = 0; jh < 14; jh++) {
        ctx.beginPath()
        ctx.arc(x0 + Math.random() * (x1 - x0), -halfTh + Math.random() * halfTh * 2, 2, 0, 6.283)
        ctx.fill()
      }
    } else if (kind === "yuntianghuanmeng") {
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      for (var yt = 0; yt < 4; yt++) {
        var yty = -halfTh + yt * (halfTh * 0.7)
        ctx.beginPath()
        ctx.arc((x0 + x1) / 2 - 10, yty, 10, 0, 6.283)
        ctx.arc((x0 + x1) / 2 + 10, yty, 10, 0, 6.283)
        ctx.fill()
      }
    } else if (kind === "bingjingxuepo") {
      ctx.strokeStyle = "rgba(120,180,220,0.8)"
      ctx.lineWidth = 1.5
      for (var bj = 0; bj < 4; bj++) {
        var bjy = -halfTh + bj * (halfTh * 0.7)
        ctx.beginPath()
        ctx.moveTo((x0 + x1) / 2, bjy - 8)
        ctx.lineTo((x0 + x1) / 2, bjy + 8)
        ctx.moveTo((x0 + x1) / 2 - 8, bjy)
        ctx.lineTo((x0 + x1) / 2 + 8, bjy)
        ctx.stroke()
      }
    } else if (kind === "wanxiangquanzhang") {
      ctx.strokeStyle = "rgba(232,200,120,0.85)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x0, -halfTh * 0.5)
      ctx.bezierCurveTo((x0 + x1) / 2, -halfTh, x1, -halfTh * 0.5, x1, 0)
      ctx.stroke()
    } else if (kind === "qilin") {
      ctx.strokeStyle = "#ffb347"
      ctx.lineWidth = 2.5
      ctx.globalAlpha = 0.95
      for (var f = 0; f < 5; f++) {
        var fx = x0 + 8 + f * ((x1 - x0) / 5)
        ctx.beginPath()
        ctx.moveTo(fx, halfTh)
        ctx.quadraticCurveTo(fx + 6, 0, fx, -halfTh)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  function drawCuePreview(cv, kind, c1, c2, phase) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, shadeColor(c2, -0.05))
    bg.addColorStop(1, shadeColor(c2, -0.18))
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-Math.PI / 4)
    // 杆长按画布较短边收敛，保证 45° 旋转后不出框
    var halfLen = Math.min(W * 0.5, H * 0.7),
      halfTh = H * 0.15
    if (typeof phase === "number") {
      // 模拟球杆绕长轴自转：相位决定厚度方向压缩量（边缘视角最薄），呈现 3D 转动感
      var sy = 0.34 + 0.66 * Math.abs(Math.cos(phase))
      ctx.scale(1, sy)
      ctx.translate(Math.sin(phase) * halfLen * 0.06, 0)
    }
    var g = ctx.createLinearGradient(-halfLen, 0, halfLen, 0)
    g.addColorStop(0, c2)
    g.addColorStop(0.55, c1)
    g.addColorStop(0.85, "#efe0bf")
    g.addColorStop(1, "#f4ead0")
    ctx.fillStyle = g
    roundRect(ctx, -halfLen * 0.92, -halfTh, halfLen * 1.84, halfTh * 2, halfTh)
    ctx.fill()
    ctx.fillStyle = "#caa15a"
    roundRect(ctx, halfLen * 0.62, -halfTh, halfLen * 0.16, halfTh * 2, 3)
    ctx.fill()
    ctx.fillStyle = "#3a6ea5"
    roundRect(ctx, halfLen * 0.78, -halfTh * 0.62, halfLen * 0.12, halfTh * 1.24, 3)
    ctx.fill()
    drawCueMotif(ctx, kind, halfLen, halfTh)
    ctx.restore()
  }

  /**
   * v1.3.103：给卡片挂两类预览。
   *
   * 1）**2D 占位图**（立即、同步、零成本）—— 由 drawScenePreview /
   *    drawCuePreview 手绘。它是"先顶上"的兜底，
   *    保证首屏立刻有图、且 WebGL 不可用时菜单依然可用。
   * 2）**3D 真图**（懒加载、逐张替换）—— 由 skin-preview-3d.js 用游戏内
   *    真实贴图离屏渲染。只有当卡片滚动进视口时才排队渲染，渲染成功就
   *    覆盖掉 2D 占位；失败/不支持则静默保留 2D 图。
   *
   * 为什么不一上来就全部渲染 3D：19 款球杆 + 13 款球桌 + 6 个场景共 38 张，
   * 每张都要建场景、编译着色器、读回像素 —— 一次性做完会明显卡顿。
   * 懒加载 + requestIdleCallback 分片后，用户滑到哪儿才渲染哪儿。
   */
  function applyCardPreviews() {
    // ---- 1) 2D 占位（同步立即出图）----
    Array.prototype.forEach.call(
      document.querySelectorAll("#sceneCards .skin-card"),
      function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (sw && !sw.dataset.pv) {
          var photo = card.getAttribute("data-photo")
          if (photo) {
            // Request D：照片场景用实景照片作缩略图
            var pimg = new Image()
            pimg.onload = function () {
              var cv = makeCanvas(150, 150)
              drawPhotoCover(cv, pimg)
              sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
            }
            pimg.src = photo
          } else {
            var cv = makeCanvas(150, 150)
            drawScenePreview(cv, card.dataset.pattern, card.dataset.c1, card.dataset.c2)
            sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          }
          sw.dataset.pv = "1"
        }
      }
    )
    Array.prototype.forEach.call(
      document.querySelectorAll("#cueThemeCards .skin-card"),
      function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (sw && !sw.dataset.pv) {
          var cv = makeCanvas(150, 150)
          drawCuePreview(cv, card.dataset.pattern, card.dataset.c1, card.dataset.c2)
          sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          sw.dataset.pv = "1"
        }
      }
    )

    // ---- 2) 3D 真图（懒加载 + 逐张替换）----
    scheduleCardPreview3D()
  }

  // ---------- v1.3.103：卡片缩略图的真 3D 渲染 ----------
  //
  // 加载链：three.standalone.js（挂 window.THREE）
  //        → skin-factory.js（挂 window.CueGameSkin：游戏内真实贴图工厂 +
  //           TableGeometry / R 等几何参数；必须在 three 之后注入，原因同
  //           loadCuePreview3DLib 的注释）
  //        → cue-texture-factory.js（挂 window.CueGameCue：球杆贴图与长度）
  //        → skin-preview-3d.js（挂 window.SkinPreview3D，渲染本体）
  //
  // 只在**真的有卡片进入视口**时才加载，菜单首屏不受拖累。
  var skin3DScriptPromise = null
  function loadSkinPreview3DLib() {
    if (skin3DScriptPromise) return skin3DScriptPromise
    skin3DScriptPromise = new Promise(function (resolve, reject) {
      if (window.SkinPreview3D) { resolve(); return }
      var base = window.__APP_ROOT__ || ""
      function inject(src, ok, fail) {
        var s = document.createElement("script")
        s.src = base + src
        s.onload = ok
        s.onerror = function () { fail(new Error("加载失败: " + src)) }
        document.head.appendChild(s)
      }
      inject("three.standalone.js", function () {
        inject("skin-factory.js", function () {
          inject("cue-texture-factory.js", function () {
            inject("skin-preview-3d.js", function () {
              if (window.SkinPreview3D) resolve()
              else reject(new Error("SkinPreview3D 未定义"))
            }, reject)
          }, reject)
        }, reject)
      }, reject)
    })
    return skin3DScriptPromise
  }

  // 渲染队列：存 {sw, kind, id}，用 IntersectionObserver 投递
  var preview3DQueue = []
  var preview3DRunning = false
  var preview3DObserver = null

  /** 把队列里的任务分批在空闲时段渲染，逐张替换色块背景 */
  function drainPreview3DQueue() {
    if (preview3DRunning || !preview3DQueue.length) return
    preview3DRunning = true
    var P = window.SkinPreview3D
    // v1.4.0：批量 3→8 —— 静态图直出后每张只是一次图片解码（<10ms），
    // 一批 8 张仍远轻于旧版单张 3D 渲染；减少 idle 调度轮数，
    // 面板打开后所有卡片更快收敛。
    var BATCH = 8

    function step() {
      var n = 0
      while (n < BATCH && preview3DQueue.length) {
        var job = preview3DQueue.shift()
        n++
        var sw = job.sw
        // 已经被渲染过（或卡片已从 DOM 移除）就跳过
        if (!sw || !sw.isConnected || sw.dataset.pv3d === "1") continue
        // v1.3.104：预热缓存命中 → 免渲染直接出图（点开面板秒出，不卡顿）
        var cached = getCachedThumb(job.kind, job.id)
        if (cached) {
          sw.style.backgroundImage = "url(" + cached + ")"
          sw.dataset.pv3d = "1"
          continue
        }
        if (cached === null) {
          // 预热时已确认失败：保留 2D 占位，不再重试
          sw.dataset.pv3d = "fail"
          continue
        }
        // v1.4.0：缓存 miss 先试构建期静态图（零渲染开销），
        // 静态缺失才回退运行时渲染 —— 全部异步化，不阻塞空闲分片。
        ;(function (sw, kind, id) {
          ensureThumb(kind, id, function (url) {
            if (!sw.isConnected) return
            if (url) {
              sw.style.backgroundImage = "url(" + url + ")"
              sw.dataset.pv3d = "1"
            } else {
              // 标记"已尝试但失败"，避免反复重试
              sw.dataset.pv3d = "fail"
            }
          })
        })(sw, job.kind, job.id)
      }
      if (preview3DQueue.length) schedule()
      else preview3DRunning = false
    }
    function schedule() {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(step, { timeout: 400 })
      } else {
        window.setTimeout(step, 24)
      }
    }
    schedule()
  }

  /**
   * 建立 IntersectionObserver：卡片进入视口才把它的渲染任务入队。
   * 不支持 IntersectionObserver 的老 WebView 直接退化为「全部入队」，
   * 行为仍正确，只是首屏可能稍慢。
   */
  function scheduleCardPreview3D() {
    if (!preview3DObserver) {
      if (!window.IntersectionObserver) {
        // 老环境：一次性全部入队
        collectPreview3DJobs(function (job) { preview3DQueue.push(job) })
        loadSkinPreview3DLib().then(drainPreview3DQueue, function () {})
        return
      }
      preview3DObserver = new IntersectionObserver(
        function (entries) {
          var added = 0
          entries.forEach(function (en) {
            if (!en.isIntersecting) return
            var job = jobForCard(en.target)
            if (job) {
              preview3DQueue.push(job)
              added++
            }
            preview3DObserver.unobserve(en.target)
          })
          if (added) {
            // 有卡片可见了，才去加载那套 3D 库；加载成功再开始消化队列
            loadSkinPreview3DLib().then(drainPreview3DQueue, function () {})
          }
        },
        { root: null, rootMargin: "120px 0px" }
      )
    }
    collectPreview3DJobs(function (job) {
      preview3DObserver.observe(job.card)
    })
  }

  /** 遍历三类卡片，产出 {card, sw, kind, id} */
  function collectPreview3DJobs(cb) {
    function each(sel, attr, kind) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (!sw) return
        // 已经有 3D 图 / 已尝试过就跳过
        if (sw.dataset.pv3d) return
        var id = card.getAttribute(attr)
        // 有实拍照片的场景不走 3D（照片优先）
        if (kind === "scene" && card.getAttribute("data-photo")) return
        if (!id) return
        cb({ card: card, sw: sw, kind: kind, id: id })
      })
    }
    each("#sceneCards .skin-card", "data-scene", "scene")
    each("#cueThemeCards .skin-card", "data-cuetheme", "cue")
  }

  /** 按卡片元素反查它的渲染任务 */
  function jobForCard(card) {
    var sw = card.querySelector(".skin-swatch")
    if (!sw || sw.dataset.pv3d) return null
    var kind = null
    var id = null
    if (card.hasAttribute("data-scene")) {
      if (card.getAttribute("data-photo")) return null  // 照片场景不渲染 3D
      kind = "scene"; id = card.getAttribute("data-scene")
    } else if (card.hasAttribute("data-cuetheme")) {
      kind = "cue"; id = card.getAttribute("data-cuetheme")
    }
    if (!kind || !id) return null
    return { card: card, sw: sw, kind: kind, id: id }
  }

  var NAME_OF = {
    scene: function (id) {
      var c = document.querySelector('#sceneCards .skin-card[data-scene="' + id + '"]')
      return c ? c.querySelector(".skin-name").textContent : "室内"
    },
    cuetheme: function (id) {
      var c = document.querySelector('#cueThemeCards .skin-card[data-cuetheme="' + id + '"]')
      return c ? c.querySelector(".skin-name").textContent : "随台面"
    },
  }

  /* ============================================================================
   * v1.3.104：首页三行缩略图改「实物」+ 球杆主题提前预渲染
   *
   * 【问题 1｜首页缩略图非实物】
   *   refreshCustomRows() 原本用 drawScenePreview / drawCuePreview /
   *   drawScenePreview / drawCuePreview 两个 canvas 2D 手绘函数画示意图 —— 与游戏内
   *   真实贴图毫无关系，和二级面板里的 3D 实物缩略图也对不上。
   *
   * 【问题 2｜点开「球杆主题」面板会卡顿一下】
   *   19 张球杆卡片的 3D 图是「滑到可见才渲染」，用户一点开面板，
   *   19 张集中排队 → 肉眼可见的停顿。
   *
   * 【解法】
   *   共用同一套 window.SkinPreview3D。首页空闲时（startup + 2.5s）
   *   先把**球杆主题 20 款**与**首页当前三项**预渲染并缓存到
   *   preview3DCache，之后：
   *     · 首页当前项直接取缓存出图；
   *     · 二级面板卡片命中缓存则**同步秒出**，不再需要排队。
   * ========================================================================== */

  /** kind:id → dataURL 缓存；记录「已试过但失败」（null）避免反复重试 */
  var preview3DCache = {}
  function cacheKey(kind, id) {
    return kind + ":" + id
  }
  /** 取缓存；miss 返回 undefined，hit-but-failed 返回 null */
  function getCachedThumb(kind, id) {
    var k = cacheKey(kind, id)
    return Object.prototype.hasOwnProperty.call(preview3DCache, k) ? preview3DCache[k] : undefined
  }
  /** 渲染并写缓存（失败存 null）。返回 url 或 null。 */
  function renderAndCache(kind, id) {
    var P = window.SkinPreview3D
    if (!P) return null
    var url = null
    try {
      url = P.renderThumb(kind, id)
    } catch (e) {
      url = null
    }
    preview3DCache[cacheKey(kind, id)] = url
    return url
  }

  /* ============================================================================
   * v1.4.0：缩略图「构建期静态图优先」—— 打开软件不再渲染 3D
   *
   * 用户反馈：「后台渲染一次缩略图，然后各自截图用于缩略图展示，不要每次
   * 打开软件渲染了，太慢了」。构建脚本 tools/render/render-previews.js 在
   * 打包前用 headless chrome 走**同一条** SkinPreview3D 管线把全部 35 张
   * 缩略图渲染成 dist/previews/<kind>-<id>.jpg（260×120 JPEG，与运行时
   * 输出同参数），菜单改为静态图直出：
   *   1. preview3DCache 命中 → 直接用（不变）；
   *   2. 静态文件 previews/<kind>-<id>.jpg 加载成功 → 写缓存直接用，
   *      **零渲染开销**（每张 ~2KB，本地/APK 内加载 <10ms）；
   *   3. 静态缺失（未来新增皮肤未预渲染）→ 回退运行时渲染（原管线保留）。
   */
  /** 静态图加载结果缓存：url（成功）/ null（失败，不重复请求） */
  var staticThumbTried = {}
  function staticThumbPath(kind, id) {
    return "previews/" + kind + "-" + id + ".jpg"
  }
  function loadStaticThumb(kind, id, cb) {
    var k = cacheKey(kind, id)
    if (staticThumbTried[k] !== undefined) {
      cb(staticThumbTried[k])
      return
    }
    var rel = staticThumbPath(kind, id)
    var img = new Image()
    img.onload = function () {
      staticThumbTried[k] = rel
      cb(rel)
    }
    img.onerror = function () {
      staticThumbTried[k] = null
      cb(null)
    }
    img.src = (window.__APP_ROOT__ || "") + rel
  }
  /**
   * 统一异步获取链：缓存 → 静态图 → 运行时渲染兜底。
   * done(url)：成功给 url；彻底失败给 null（调用方保留 2D 占位）。
   */
  function ensureThumb(kind, id, done) {
    var cached = getCachedThumb(kind, id)
    if (cached !== undefined) {
      done(cached)
      return
    }
    loadStaticThumb(kind, id, function (url) {
      if (url) {
        preview3DCache[cacheKey(kind, id)] = url
        done(url)
        return
      }
      loadSkinPreview3DLib().then(function () {
        var u = null
        try {
          u = renderAndCache(kind, id)
        } catch (e) {
          u = null
        }
        done(u || null)
      }, function () {
        done(null)
      })
    })
  }

  /** 首页当前三项：缓存/静态命中直接出图；否则异步取（先回 2D 占位） */
  function applyHomeThumb(el, kind, id) {
    if (!el || !id) return false
    var url = getCachedThumb(kind, id)
    if (url !== undefined) {
      if (url) {
        el.style.backgroundImage = "url(" + url + ")"
        return true
      }
      return false
    }
    // v1.4.0：不再同步渲染（这正是「打开软件太慢」的来源）——
    // 本帧先回 false 让 2D 占位上屏，静态图/渲染完成后异步替换。
    ensureThumb(kind, id, function (u) {
      if (u && el.isConnected) {
        el.style.backgroundImage = "url(" + u + ")"
      }
    })
    return false
  }

  /** 首页空闲预热：球杆 20 款 + 首页当前三项（分片在 idle 里跑） */
  var preview3DWarmed = false
  function warmUpPreviews() {
    if (preview3DWarmed) return
    preview3DWarmed = true
    loadSkinPreview3DLib().then(function () {
      var P = window.SkinPreview3D
      if (!P || !P.warmUp) return
      try {
        P.warmUp()
      } catch (e) {}
      // 预热清单：先把球杆主题全部渲染好，再补首页当前的两项非球杆皮肤
      var jobs = []
      Array.prototype.forEach.call(
        document.querySelectorAll("#cueThemeCards .skin-card[data-cuetheme]"),
        function (c) {
          jobs.push({ kind: "cue", id: c.getAttribute("data-cuetheme") })
        }
      )
      var curScene = settings.scene || "room"
      var sceneCard = document.querySelector('#sceneCards .skin-card[data-scene="' + curScene + '"]')
      // 有实拍照片的场景首页缩略图也用照片，不必预热 3D
      if (!(sceneCard && sceneCard.getAttribute("data-photo"))) {
        jobs.push({ kind: "scene", id: curScene })
      }

      // v1.4.0：预热 = 静态图预载（每张 ~2KB，纯图片解码，无 3D 渲染）。
      // 仅当静态缺失时才经 ensureThumb 的兜底分支触发运行时渲染。
      var WARM_BATCH = 10
      function step() {
        var n = 0
        while (n < WARM_BATCH && jobs.length) {
          var j = jobs.shift()
          n++
          if (getCachedThumb(j.kind, j.id) !== undefined) continue
          ensureThumb(j.kind, j.id, function () {})
        }
        if (jobs.length) {
          if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 500 })
          else window.setTimeout(step, 32)
        } else {
          // 预热完成后，把首页三行换成实物缩略图
          refreshHomeThumbs()
        }
      }
      if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 500 })
      else window.setTimeout(step, 32)
    }, function () {})
  }

  /** 只刷新首页三行的缩略图（不碰文案），优先用缓存 */
  function refreshHomeThumbs() {
    var ts = $("thumbScene")
    if (ts) {
      var sc = document.querySelector('#sceneCards .skin-card[data-scene="' + (settings.scene || "room") + '"]')
      if (sc) {
        var photo = sc.getAttribute("data-photo")
        if (photo) {
          // 照片场景：仍用实景照片（3D 场景是示意，照片才是实物）
          var pimg = new Image()
          pimg.onload = function () {
            var cv = makeCanvas(92, 92)
            drawPhotoCover(cv, pimg)
            ts.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          }
          pimg.src = photo
        } else if (!applyHomeThumb(ts, "scene", sc.getAttribute("data-scene"))) {
          var cv0 = makeCanvas(92, 92)
          drawScenePreview(cv0, sc.dataset.pattern, sc.dataset.c1, sc.dataset.c2)
          ts.style.backgroundImage = "url(" + cv0.toDataURL() + ")"
        }
      }
    }
    var tc = $("thumbCue")
    if (tc) {
      var cid = settings.cueTheme || "auto"
      if (!applyHomeThumb(tc, "cue", cid)) {
        var cc = document.querySelector('#cueThemeCards .skin-card[data-cuetheme="' + cid + '"]')
        if (cc) {
          var cv2 = makeCanvas(92, 92)
          drawCuePreview(cv2, cc.dataset.pattern, cc.dataset.c1, cc.dataset.c2)
          tc.style.backgroundImage = "url(" + cv2.toDataURL() + ")"
        }
      }
    }
  }

  /** 刷新首页「外观定制」三行的缩略图与当前值（item 4） */
  function refreshCustomRows() {
    // 文案先更新（同步、无副作用）
    if ($("valScene")) $("valScene").textContent = NAME_OF.scene(settings.scene)
    if ($("valCue")) $("valCue").textContent = NAME_OF.cuetheme(settings.cueTheme)
    // 缩略图：优先取预热缓存出「实物」图，未命中则回退 2D 占位
    refreshHomeThumbs()
  }

  /* ---------------- 启动游戏 ---------------- */

  /**
   * v1.5.1：与游戏内 Settings.hasSeenGuide() 对齐的三通道判定。
   * 顺序：globalThis 内存标记 → 菜单内存 settings → localStorage 独立 key。
   * 任一为真即视为已看过引导（引导一旦看过就永不自动再弹）。
   */
  function hasSeenGuideLocal() {
    if (globalThis.__billiardsSeenGuide === true) return true
    if (settings && settings.seenGuide) return true
    try {
      if (localStorage.getItem("billiards_cn_seenGuide_v1") === "1") {
        settings.seenGuide = true
        return true
      }
    } catch (e) { /* localStorage 不可用时忽略 */ }
    return false
  }

  function startGame() {
    var params = []
    params.push("ruletype=" + encodeURIComponent(selectedRule))
    if (selectedOpponent === "lan") {
      // v1.3.65：联机时主「开始游戏」按钮等价于建房（面板里的按钮是主入口）
      startLan("host")
      return
    }
    if (selectedOpponent !== "solo") {
      params.push("bot=" + encodeURIComponent(selectedOpponent))
      if (settings.turnTimer && settings.turnTimer > 0) {
        params.push("timer=" + settings.turnTimer)
      }
    } else {
      // 落袋类玩法在无对手时进入自由练习
      params.push("practice=true")
    }

    // 分步实操新手引导：仅首次安装或手动「重新打开新手引导」后自动显示一次。
    // 由游戏内引导完成时写入 seenGuide，之后进入任何对局都不再自动弹出。
    //
    // v1.5.1：这里改用与 Settings.hasSeenGuide() 完全一致的三通道判定。
    // 此前只看内存 settings.seenGuide，而游戏内 Tutorial.finish() 是
    // 「内存标记 + 主 key + 独立 key」三路写入 —— 只要主 key 落盘失败而
    // 菜单页恰好在独立 key 同步前读取，就会误判为「没看过」→ 又拼 tutorial=1。
    // 另：tutorial=1 只在真正首局拼上，重开对局不再重复携带（见 notification.ts
    // 的 RESTART_DROP_PARAMS）。
    if (!hasSeenGuideLocal()) {
      params.push("tutorial=1")
    }
    location.replace("play.html?" + params.join("&"))
  }

  /** 轻量 toast 提示（不依赖外部库） */
  function showToast(msg) {
    try {
      var el = document.createElement("div")
      el.textContent = msg
      el.style.cssText =
        "position:fixed;left:50%;bottom:18%;transform:translateX(-50%);" +
        "max-width:80vw;padding:10px 16px;background:rgba(20,28,40,.92);" +
        "color:#f3d79a;font-size:14px;font-weight:700;line-height:1.4;" +
        "border:1.5px solid #c89534;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "z-index:99999;text-align:center;pointer-events:none;" +
        "transition:opacity .25s ease;opacity:1;"
      document.body.appendChild(el)
      setTimeout(function () {
        el.style.opacity = "0"
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el)
        }, 280)
      }, 1800)
    } catch (e) {}
  }

  /** 从设置页「重新打开新手引导」：v1.2.9 #F4 / v1.2.11 #F6
   *  不再直接进入游戏——只把「已看过新手引导」复位，
   *  下次用户自行进入对局（任意玩法）时即会显示引导；由用户自行操作，不自动开局。
   *  v1.2.11 #F6：原实现只改 localStorage + globalThis，未更新内存 settings.seenGuide，
   *  导致 startGame() 里 !settings.seenGuide 判定仍为 false（不传 tutorial=1）→ 引导永不显示。
   *  现在同步复位内存 settings.seenGuide，确保下次进对局 forceTutorial=true。 */
  function replayTutorial() {
    settings.seenGuide = false
    saveSettings(settings)
    try {
      localStorage.removeItem("billiards_cn_seenGuide_v1")
    } catch (e) {}
    try {
      globalThis.__billiardsSeenGuide = false
    } catch (e) {}
    showToast("已开启新手引导，进入对局即可看到")
  }

  /* ---------------- 初始化 ---------------- */

  // v1.3.19：应用界面语言并刷新依赖语言的动态内容
  function applyLang(l) {
    setLang(l)
    localize(document, l)
    renderQualityOptions()
    if ($("qualityHint")) $("qualityHint").textContent = QH(settings.lod)
    if ($("setTLineVal")) $("setTLineVal").textContent = TL(settings.targetLineLength || 3)
    refreshCustomRows()
    // v1.3.60：语言分段控件已随「语言」整组从设置面板移除，此处不再回写选中态
    if (currentRuleForLang) showModeRules(currentRuleForLang)
    // 通知父页面（游戏内覆盖层）语言已变更
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "billiards-language", language: l }, "*")
      }
    } catch (e) {}
  }

  // v1.4.5 修复「偶发首页点击开始游戏无反应」：
  // 原 init() 把 btnStart/btnGuide/btnSettings 的绑定放在**最后一步**，
  // 前面 localize/initModes/initLanPanel/initSettingsPanel 等十几个子步骤
  // 任何一步在特定设置状态/特定 WebView 上抛异常，按钮就永远不会被绑定 ——
  // 表现即「点开始游戏没反应」。现改为：init() 一进来先绑核心三键（防重复
  // 绑定），再依次做其余初始化；每个子步骤独立 try-catch，一步失败不拖垮
  // 全部（其余入口按钮也尽量保住）。
  var __coreBound = false
  function bindCoreButtons() {
    if (__coreBound) return
    __coreBound = true
    try {
      $("btnStart").addEventListener("click", function () {
        buzz(15)
        startGame()
      })
      $("btnGuide").addEventListener("click", function () {
        showScreen("guide")
      })
      $("btnSettings").addEventListener("click", function () {
        syncSettingsUI()
        showScreen("settings")
      })
    } catch (e) {
      try {
        console.error("[menu] 核心按钮绑定失败", e)
      } catch (e2) {}
    }
  }

  /** 单个子初始化的隔离执行：失败只记日志，不中断后续步骤 */
  function safeInit(name, fn) {
    try {
      fn()
    } catch (e) {
      try {
        console.error("[menu] init 步骤失败: " + name, e)
      } catch (e2) {}
    }
  }

  /**
   * v1.5.0：把回调推到「首帧绘制完成之后」再执行。
   * 双 rAF 保证浏览器已经完成一次真实绘制，再套一层 setTimeout(0) 让排在前面的
   * 微任务/渲染收尾先跑完。用于把非首屏的初始化挪出首屏关键路径。
   */
  function deferAfterFirstPaint(fn) {
    if (typeof window.requestAnimationFrame !== "function") {
      window.setTimeout(fn, 0)
      return
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        window.setTimeout(function () {
          try { fn() } catch (e) {}
        }, 0)
      })
    })
  }

  function init() {
    // v1.4.5：核心按钮最先绑定 —— 之后任何初始化失败都不影响「开始游戏」
    bindCoreButtons()
    // 主题按钮（设置页）尽早绑定，不等二级屏延后初始化
    safeInit("initThemeButtons", initThemeButtons)
    // v1.3.12：外观定制双端均默认展开。
    // HTML 里 <details id="customDetails" open> 已默认展开；不再对 APP 端（html.in-app）
    // 强制收回，用户要求"app 端外观定制不要折叠"。

    // v1.4.5：每个子步骤独立隔离 —— 任一失败只记日志，不再中断后续绑定
    safeInit("localize", function () {
      localize(document, curLang())
    })
    safeInit("initModes", initModes)
    safeInit("initOpponents", initOpponents)

    // v1.5.0：首屏只做「首页看得到的东西」。
    // 以下初始化都属于**二级页面**（外观定制 / 球杆主题 / 场景 / 回放 / 设置面板），
    // 玩家在首页根本看不到，却和首屏抢主线程 —— 返回主菜单时这段是白付的成本。
    // 现统一延后到首帧绘制完成之后执行（见 deferAfterFirstPaint）：
    // 首页可见内容不变、可点按钮（开始游戏/玩法/难度）在首帧前就已绑定完毕，
    // 二级面板的渲染延后几十毫秒，用户点开时早已就绪（点开二级页本身就要几百毫秒）。
    deferAfterFirstPaint(function () {
      safeInit("initLanPanel", initLanPanel)
      safeInit("initSettingsPanel", initSettingsPanel)
      safeInit("initCueThemes", initCueThemes)
      safeInit("initScenes", initScenes)
      // v1.2.12：恢复首页「查看回放」按钮绑定（v1.2.11 #3 误删 initMyReplays 时一并丢失）
      safeInit("initReplays", initReplays)
      safeInit("applyCardPreviews", applyCardPreviews)
      safeInit("refreshCustomRows", refreshCustomRows)
    })

    // 首页「外观定制」二级菜单入口（item 4）
    Array.prototype.forEach.call(
      document.querySelectorAll("#customRows .menu-row"),
      function (row) {
        row.addEventListener("click", function () {
          buzz(10)
          showScreen(row.getAttribute("data-target"))
        })
      }
    )

    // v1.3.104：首页空闲时预渲染球杆主题等，点开二级面板即秒出（消除卡顿）
    // 延后 2.5s，避开首屏启动竞争
    window.setTimeout(warmUpPreviews, 2500)

    // v1.4.5：btnStart/btnGuide/btnSettings 已提前到 init() 开头绑定（见 bindCoreButtons），
    // 此处原绑定代码删除，避免重复绑定导致一次点击触发两次 startGame。

    // v1.3.60：语言分段控件已从设置面板移除（DOM 一并删除），绑定代码同步移除。

    var licenseBtn = $("btnLicense")
    if (licenseBtn) {
      licenseBtn.addEventListener("click", function () {
        showScreen("license")
      })
    }

    // v1.1.12：关于页 → 变更履历（独立屏）
    // v1.5.0：履历正文（约 286KB，原占 menu.html 的 86%）已抽离到 changelog-data.js，
    // 点击时才动态加载注入。此前它随 menu.html 每次整页加载都白付解析成本 ——
    // 真机实测（CPU 6x 降速）「点返回主菜单 → 主菜单首帧」3.4~4.1 秒，主因就是它。
    var changelogBtn = $("btnChangelog")
    if (changelogBtn) {
      changelogBtn.addEventListener("click", function () {
        buzz(15)
        injectChangelog(function () {
          showScreen("changelog")
        })
      })
    }

    // ---------- 关于页：GitHub 项目链接 ----------
    // WebView 内不加载外链（应用保持纯离线），点击后交给系统浏览器打开；
    // 若设备没有可用浏览器，则退化为复制链接到剪贴板。
    var GITHUB_URL = "https://github.com/huang336-cc/taiqiu_offline"

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
          return true
        }
      } catch (e) {
        /* 继续走兜底方案 */
      }
      try {
        var ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        var ok = document.execCommand("copy")
        document.body.removeChild(ta)
        return ok
      } catch (e) {
        return false
      }
    }

    function flashLabel(btn, text) {
      if (!btn || btn.dataset.flashing === "1") return
      var old = btn.textContent
      btn.dataset.flashing = "1"
      btn.textContent = text
      setTimeout(function () {
        btn.textContent = old
        btn.dataset.flashing = "0"
      }, 1400)
    }

    var githubBtn = $("btnGithub")
    if (githubBtn) {
      githubBtn.addEventListener("click", function () {
        buzz(15)
        var url = githubBtn.getAttribute("data-url") || GITHUB_URL
        try {
          window.open(url, "_blank")
        } catch (e) {
          copyText(url)
        }
      })
    }

    // 「查看 GitHub Release 更新」：同样交给系统浏览器打开 Release 页
    var releasesBtn = $("btnReleases")
    if (releasesBtn) {
      releasesBtn.addEventListener("click", function () {
        buzz(15)
        var url =
          releasesBtn.getAttribute("data-url") ||
          GITHUB_URL + "/releases"
        try {
          window.open(url, "_blank")
        } catch (e) {
          copyText(url)
        }
      })
    }

    // v1.2.11 #F5：删除「复制链接」按钮的绑定（按钮已从 HTML 移除）。

    // 关于 / 许可页里的 <a> 外链，统一走系统浏览器
    var extLinks = document.querySelectorAll("a.ext-link")
    Array.prototype.forEach.call(extLinks, function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault()
        buzz(10)
        try {
          window.open(a.getAttribute("href"), "_blank")
        } catch (e) {
          copyText(a.getAttribute("href"))
        }
      })
    })

    var replayBtn = $("btnReplayTutorial")
    if (replayBtn) {
      replayBtn.addEventListener("click", function () {
        buzz(15)
        replayTutorial()
      })
    }

    // data-back 可指定返回目标，缺省回主页
    // v1.5.1：走 goBackScreen（history.back + popstate 落 UI），
    // 让「点返回按钮」与「按系统返回键」走同一条路径、栈状态一致。
    var backs = document.querySelectorAll("[data-back]")
    Array.prototype.forEach.call(backs, function (b) {
      b.addEventListener("click", function () {
        goBackScreen(b.getAttribute("data-back") || "home")
      })
    })

    var v = $("versionText")
    if (v) v.style.display = "none"

    // 用构建时注入的 __BILLIARDS_VERSION__ 同步刷新「关于」页的版本单元格，
    // 避免 HTML 里的硬编码版本号随着打包逐渐过期。
    var versionCell = $("versionCell")
    if (versionCell && typeof window.__BILLIARDS_VERSION__ === "string") {
      var raw = window.__BILLIARDS_VERSION__
      // "1.1.0-26080504" → 显示主版本号；如需详细可改成 raw
      var main = raw.split("-")[0]
      if (main) versionCell.textContent = main
      versionCell.title = raw
    }
  }

  /* ---------------- 球杆主题卡片（item 2） ---------------- */

  /* ===================== 球杆 3D 预览（原生 WebGL，不引 three.js） ===================== */
  // 生成球杆皮展开纹理：宽=周向(256) 高=杆长(1024)，轴向渐变 + 纹样
  function makeCueSkinCanvas(kind, c1, c2) {
    var W = 256, H = 1024
    var cv = makeCanvas(W, H)
    var ctx = cv.getContext("2d")
    // 轴向渐变底（皮头在底端=亮木色）
    var g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0.0, c2)
    g.addColorStop(0.5, c1)
    g.addColorStop(0.82, "#efe0bf")
    g.addColorStop(1.0, "#f4ead0")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // 纹样：drawCueMotif 的 x=杆长 y=厚度，旋转 -90° 映射到 展开图(宽=周 高=轴)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-Math.PI / 2)
    // 调用前把全局 alpha 等状态交给 drawCueMotif（其内部自带 save/restore）
    try { drawCueMotif(ctx, kind, H, W / 2) } catch (e) {}
    ctx.restore()
    // 两端金属环
    ctx.fillStyle = "#caa15a"
    ctx.fillRect(0, H * 0.84, W, H * 0.05)
    ctx.fillStyle = "#3a6ea5"
    ctx.fillRect(0, H * 0.90, W, H * 0.035)
    return cv
  }

  // 极简 mat4 工具
  function m4identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }
  function m4mul(a, b) {
    var o = new Array(16)
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      o[r*4+c] = a[r*4+0]*b[0*4+c] + a[r*4+1]*b[1*4+c] + a[r*4+2]*b[2*4+c] + a[r*4+3]*b[3*4+c]
    }
    return o
  }
  function m4perspective(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2)
    return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,(2*f*n)/(n-f),0]
  }
  function m4translate(x, y, z) { var m = m4identity(); m[12]=x; m[13]=y; m[14]=z; return m }
  function m4rotX(a){var c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,0,c,-s,0,0,s,c,0,0,0,0,1]}
  function m4rotY(a){var c=Math.cos(a),s=Math.sin(a);return[c,0,s,0,0,1,0,0,-s,0,c,0,0,0,0,1]}

  // 生成圆柱侧面顶点（轴沿 Y，半径 rad，高 hgt，seg 段），返回 {pos,nrm,uv,idx}
  function buildCylinder(rad, hgt, seg) {
    var pos = [], nrm = [], uv = [], idx = []
    var y0 = -hgt/2, y1 = hgt/2
    for (var i = 0; i <= seg; i++) {
      var u = i / seg
      var ang = u * Math.PI * 2
      var cx = Math.cos(ang), cz = Math.sin(ang)
      // 两个端点（底/顶）同 uv.u，v=0/1
      pos.push(rad*cx, y0, rad*cz); nrm.push(cx,0,cz); uv.push(u, 0)
      pos.push(rad*cx, y1, rad*cz); nrm.push(cx,0,cz); uv.push(u, 1)
    }
    for (var i = 0; i < seg; i++) {
      var a = i*2, b = i*2+1, c = i*2+2, d = i*2+3
      idx.push(a,b,d, a,d,c)
    }
    return { pos:new Float32Array(pos), nrm:new Float32Array(nrm), uv:new Float32Array(uv), idx:new Uint16Array(idx) }
  }

  // 球杆主题预览：电影级写实 3D（three.js）。
  // 按需加载 three.standalone.js（挂 window.THREE）
  //   → cue-texture-factory.js（挂 window.CueGameCue：游戏内真实球杆的贴图工厂与几何参数。
  //     必须在 three 之后注入——打包时 three 是外部依赖，产物会把 window.THREE 提升为
  //     模块级常量，先注入就会拿到 undefined）
  //   → cue-preview-3d.js（挂 window.CuePreview3D，预览本体），
  // 仅首次预览时加载一次。关键：WebGLRenderer 整个页面生命周期只创建一次、永不销毁——
  // 松手只停旋转，不 dispose，避免真机 WebView「第二次新建 context 失败/丢失」导致白屏。
  var cueViewer3D = null          // CuePreview3D 实例（只创建一次，复用）
  var cue3DScriptPromise = null   // 脚本加载 Promise（缓存，只加载一次）
  function loadCuePreview3DLib() {
    if (cue3DScriptPromise) return cue3DScriptPromise
    cue3DScriptPromise = new Promise(function (resolve, reject) {
      if (window.CuePreview3D) { resolve(); return }
      var base = (window.__APP_ROOT__ || "")  // 发布目录根（默认空串=同源）
      function inject(src, ok, fail) {
        var s = document.createElement("script")
        s.src = base + src
        s.onload = ok
        s.onerror = function () { fail(new Error("加载失败: " + src)) }
        document.head.appendChild(s)
      }
      inject("three.standalone.js", function () {
        inject("cue-texture-factory.js", function () {
          inject("cue-preview-3d.js", function () {
            if (window.CuePreview3D) resolve()
            else reject(new Error("CuePreview3D 未定义"))
          }, reject)
        }, reject)
      }, reject)
    })
    return cue3DScriptPromise
  }
  // WebGL 不可用 / 加载失败时，在预览窗内给出明确提示（纯 3D 路径，不做 2D 降级）
  function showCuePreviewError(msg) {
    var cv = $("cuePreview3D")
    if (cv) {
      var ctx = cv.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "#0a0e18"; ctx.fillRect(0, 0, cv.width, cv.height)
        ctx.fillStyle = "#8fa6d8"; ctx.font = "13px sans-serif"; ctx.textAlign = "center"
        ctx.fillText(msg || "无法显示 3D 预览", cv.width / 2, cv.height / 2)
      }
    }
  }

  // 球杆主题预览（v1.3.52）：点击「已选中的卡片」全屏弹出，单指拖动旋转 / 双指捏合缩放。
  // 【红线】关闭时只 stop()，绝不 dispose / 销毁 WebGL 上下文——v1.3.32 的
  // 「第二次预览白屏」就是销毁后重建 context 失败导致的。
  var cueOverlay = null
  var cuePushedHistory = false // 本次预览是否为返回键压过一条历史
  /**
   * 关闭全屏预览。
   * @param {boolean} [fromPopState] 是否由 popstate 触发。是则不能再调 history.back()，
   *   否则会多退一步、直接退出菜单页。
   */
  function closeCuePreviewOverlay(fromPopState) {
    if (!cueOverlay) cueOverlay = $("cuePreviewOverlay")
    if (!cueOverlay) return
    if (!cueOverlay.classList.contains("active")) return
    cueOverlay.classList.remove("active")
    // 只停渲染，绝不 dispose / 释放 WebGL 上下文（见上方红线）
    if (cueViewer3D && cueViewer3D.stop) cueViewer3D.stop()
    // 清掉为返回键压入的那条历史，避免关闭后残留一次空返回
    if (cuePushedHistory) {
      cuePushedHistory = false
      if (!fromPopState) {
        try {
          // 这次 back 只是为了清掉预览压的那条历史，别让它再退一级子屏
          screenSuppressPop = true
          history.back()
        } catch (e) { /* 忽略 */ }
      }
    }
  }
  /**
   * 全屏预览的三种关闭方式：✕ 按钮 / Android 返回键 / Esc。
   * 不做「点遮罩关闭」——画布几乎铺满屏幕，没有稳定的遮罩区可点。
   */
  function bindCuePreviewClose() {
    document.addEventListener("click", function (e) {
      var t = e.target
      if (t && t.closest && t.closest("[data-close-cue-preview]")) closeCuePreviewOverlay()
    })
    window.addEventListener("popstate", function () {
      if (cuePushedHistory) closeCuePreviewOverlay(true)
    })
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.keyCode === 27) closeCuePreviewOverlay()
    })
  }
  function showCuePreviewOverlay(themeId) {
    if (!cueOverlay) cueOverlay = $("cuePreviewOverlay")
    if (!cueOverlay) return
    var card = document.querySelector(
      '#cueThemeCards .skin-card[data-cuetheme="' + themeId + '"]'
    )
    var kind = card ? card.getAttribute("data-pattern") : "auto"
    var c1 = card ? card.getAttribute("data-c1") : "#d2b48c"
    var c2 = card ? card.getAttribute("data-c2") : "#1a1a1a"
    // 顶栏显示主题名：全屏预览要让用户一眼知道在看哪一款
    var nameEl = $("cuePreviewName")
    if (nameEl) {
      var nameSpan = card ? card.querySelector(".skin-name") : null
      nameEl.textContent = nameSpan ? nameSpan.textContent : ""
    }
    cueOverlay.classList.add("active")
    // 为返回键压一条历史：Android 主 Activity 对非 play 页面走
    // webView.canGoBack() ? goBack() : finish()，压一条就能让返回键先关预览，
    // 无需改 Java（改 Java 会影响「菜单页返回 = 退出应用」的现有行为）。
    if (!cuePushedHistory) {
      try {
        history.pushState({ cuePreview: true }, "", location.href)
        cuePushedHistory = true
      } catch (e) { /* 个别环境不支持 pushState，退化为返回键直接退出页面 */ }
    }
    // 双 rAF 确保浮层布局完成、预览 canvas 有真实尺寸后再初始化 3D 渲染器。
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!cueOverlay.classList.contains("active")) return
        var cv = $("cuePreview3D")
        if (!cv) return
        // 主题色：c1=杆身主色, c2=握把/杆尾深色；金属色和皮头色从主题派生
        var wood = c1 || "#d2b48c", dark = c2 || "#1a1a1a"
        // 简单派生：金属色 = 主色提亮偏暖；皮头色 = 深色再压暗
        function hexToRgb(h) {
          var n = parseInt((h || "#000000").replace("#", ""), 16)
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
        }
        function rgbToHex(c) {
          return "#" + ((1 << 24) + (c.r << 16) + (c.g << 8) + c.b).toString(16).slice(1)
        }
        function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }
        function deriveMetal(hex) {
          var c = hexToRgb(hex)
          var lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
          if (lum < 60) return "#c9a24b" // 深色主题用经典金
          return rgbToHex({
            r: clamp(c.r * 1.25 + 25),
            g: clamp(c.g * 1.12 + 10),
            b: clamp(c.b * 0.95)
          })
        }
        function deriveTip(hex) {
          var c = hexToRgb(hex)
          return rgbToHex({ r: clamp(c.r * 0.5), g: clamp(c.g * 0.5), b: clamp(c.b * 0.5) })
        }
        loadCuePreview3DLib().then(function () {
          if (!cueOverlay.classList.contains("active")) return
          // 只创建一次 renderer（首次），之后复用，避免真机第二次新建 context 失败
          if (!cueViewer3D) {
            cueViewer3D = new window.CuePreview3D(cv)
            try {
              cueViewer3D.init()   // WebGL 不可用会在此抛出（仅首次可能）
            } catch (err) {
              cueViewer3D = null   // 初始化失败：丢弃半成品，走错误提示
              throw err
            }
          }
          // v1.3.54：先按游戏内 ID 建真实球杆（几何 + 分区贴图），再补倒影压暗色。
          // setTheme 只记颜色、不重建；重建由 setCueTheme 触发，一次打开只建一遍。
          cueViewer3D.setTheme(wood, dark, deriveMetal(wood), deriveTip(dark), kind)
          cueViewer3D.setCueTheme(themeId, settings.skin, "classic")
          // 每次打开都重置到统一的展示角度，便于横向对比不同主题
          if (cueViewer3D.resetView) cueViewer3D.resetView()
          // v1.3.52：取消自动旋转，改为按需渲染一帧（视角完全由手指控制）
          if (cueViewer3D.requestRender) cueViewer3D.requestRender()
        }).catch(function (e) {
          // 纯 3D 路径：加载或 WebGL 失败时给出明确提示，不降级 2D
          console.error("[cuePreview] 3D 预览失败:", e)
          showCuePreviewError(e && /WebGL/i.test(String(e)) ? "当前设备不支持 WebGL" : "无法加载 3D 预览")
        })
      })
    })
  }

  function initCueThemes() {
    var cards = document.querySelectorAll("#cueThemeCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle(
          "active",
          c.getAttribute("data-cuetheme") === (settings.cueTheme || "auto")
        )
      })
      // v1.3.59：游戏设置里的 #setCueTheme 已移除，无需再回写
      refreshCustomRows()
    }
    // v1.3.52：触发方式由「长按 380ms」改为「点两下」——第一下选中主题，
    // 第二下点已选中的卡片开全屏预览。长按那套（pressTimer / longFired /
    // pointerdown-up-cancel-leave 四个监听，以及 document 上全局 pointerup 关闭）
    // 整体移除，原因：
    //   ① 全局「松手即关」与预览窗内的拖动旋转直接冲突——拖完一抬手就关；
    //   ② 长按在可发现性上远不如点击，改点击后配合选中态卡片的「3D」角标
    //      与首次选中时的 toast 提示即可。
    Array.prototype.forEach.call(cards, function (c) {
      var themeId = c.getAttribute("data-cuetheme")
      c.addEventListener("click", function () {
        // 已选中 → 再点一下开全屏预览
        if (c.classList.contains("active")) {
          showCuePreviewOverlay(themeId)
          return
        }
        settings.cueTheme = themeId
        saveSettings(settings)
        syncActive()
        buzz(10)
        // 首次选中时提示一次，否则用户很难发现「再点一下能预览」
        try {
          if (localStorage.getItem("cue3dHintShown") !== "1") {
            localStorage.setItem("cue3dHintShown", "1")
            showToast("再点一下卡片可全屏预览 3D 效果")
          }
        } catch (e) { /* localStorage 不可用时静默忽略 */ }
      })
    })
    bindCuePreviewClose()
    syncActive()
  }

  /* ---------------- 环境场景卡片（item 4） ---------------- */

  function initScenes() {
    var cards = document.querySelectorAll("#sceneCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle(
          "active",
          c.getAttribute("data-scene") === (settings.scene || "snow")
        )
      })
      // v1.3.59：游戏设置里的 #setScene 已移除，无需再回写
      refreshCustomRows()
    }
    Array.prototype.forEach.call(cards, function (c) {
      c.addEventListener("click", function () {
        settings.scene = c.getAttribute("data-scene")
        saveSettings(settings)
        syncActive()
        buzz(10)
      })
    })
    syncActive()
  }

  /* ---------------- v1.2.4：我的回放（离线本地保存列表） ----------------
     与游戏内 src/utils/replay-store.ts 共用同一 IndexedDB（库名 / 表名 / keyPath），
     因此「游戏内保存」与「主菜单我的回放」共享同一数据源。 */
  var REPLAY_DB = "billiards_replays"
  var REPLAY_STORE = "replays"

  function replayOpenDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no idb"))
        return
      }
      var req = window.indexedDB.open(REPLAY_DB, 1)
      req.onupgradeneeded = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(REPLAY_STORE)) {
          db.createObjectStore(REPLAY_STORE, { keyPath: "id" })
        }
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  }

  function replayList() {
    return replayOpenDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(REPLAY_STORE, "readonly")
        var req = tx.objectStore(REPLAY_STORE).getAll()
        req.onsuccess = function () {
          db.close()
          var arr = req.result || []
          arr.sort(function (a, b) {
            return b.createdAt - a.createdAt
          })
          resolve(arr)
        }
        req.onerror = function () {
          db.close()
          reject(req.error)
        }
      })
    })
  }

  function replayDelete(id) {
    return replayOpenDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(REPLAY_STORE, "readwrite")
        tx.objectStore(REPLAY_STORE).delete(id)
        tx.oncomplete = function () {
          db.close()
          resolve()
        }
        tx.onerror = function () {
          db.close()
          reject(tx.error)
        }
      })
    })
  }

  function replayEscape(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]
    })
  }

  function replayFmtDate(ts) {
    var d = new Date(ts)
    function p(n) {
      return (n < 10 ? "0" : "") + n
    }
    return (
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      " " +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes())
    )
  }

  // v1.2.5：经 sessionStorage 传递完整回放数据，再跳转回放页。
  // 规避 Android WebView 对 URL 长度的限制（之前 ?state= 超长被截断，
  // 只回放出前几个球）。与游戏内 src/utils/replay-nav.ts 同方案。
  // v1.5.4（#69）：sessionStorage 写入失败时**不再继续跳转** —— 旧行为带一个
  // 空 replayId 跳到 play.html，回放页读不到数据只能 alert（部分 WebView 会
  // 吞掉 alert），用户看到的就是「进入回放模式后一动不动」。写失败时就地
  // 提示并留在菜单。compressed 为空/损坏的记录同样就地拦截。
  function navigateToReplay(compressed, rule) {
    if (typeof compressed !== "string" || compressed.length === 0) {
      console.error("replay data is empty or corrupted")
      try { window.alert("这条回放的数据已损坏，无法播放。") } catch (e) {}
      return
    }
    var id = "bcr_" + Date.now() + "_" + Math.floor(Math.random() * 1e9)
    try {
      sessionStorage.setItem("bcr:" + id, compressed)
    } catch (e) {
      console.error("replay sessionStorage 写入失败", e)
      try { window.alert("回放数据过大，无法在本机打开。") } catch (e2) {}
      return
    }
    location.href =
      "play.html?replayId=" +
      encodeURIComponent(id) +
      "&ruletype=" +
      encodeURIComponent(rule || "nineball")
  }

  // v1.5.5（#75）：删除回放的二次确认弹窗。
  // 不用 window.confirm —— 真机 WebView 可能吞掉原生弹窗（项目已有多起先例），
  // 与回放列表一致走自绘 DOM 弹层。pendingDeleteId 记录待删条目，确认后才删。
  var pendingDeleteId = null
  // v1.5.5（#75 修复②）：列表刷新回调。renderList 是 initReplays 的内部函数，
  // 模块级的 bindDeleteConfirm / openDeleteConfirm 直接引用会 ReferenceError
  // （被 .catch 吞掉）—— 表现为「确认删除后库里已删、列表却仍显示该条目」。
  // 由 initReplays 把真正的 renderList 注入进来。
  var refreshList = null
  function openDeleteConfirm(record) {
    var box = document.getElementById("replayDeleteConfirm")
    if (!box) {
      // 弹层 DOM 缺失（异常环境）：退回旧行为直接删，至少功能可用
      replayDelete(record.id)
        .then(function () { if (refreshList) refreshList() })
        .catch(function (err) { console.error("delete replay failed", err) })
      return
    }
    pendingDeleteId = record.id
    var nameEl = document.getElementById("replayDelName")
    if (nameEl) {
      nameEl.textContent =
        (record.label || record.rule || "未命名回放") +
        " · " + replayFmtDate(record.createdAt)
    }
    box.hidden = false
  }
  function closeDeleteConfirm() {
    var box = document.getElementById("replayDeleteConfirm")
    if (box) box.hidden = true
    pendingDeleteId = null
  }
  function bindDeleteConfirm(refresh) {
    refreshList = refresh || refreshList
    var box = document.getElementById("replayDeleteConfirm")
    if (!box) return
    Array.prototype.forEach.call(
      box.querySelectorAll("[data-replay-del-cancel]"),
      function (el) {
        el.addEventListener("click", closeDeleteConfirm)
      }
    )
    var yes = document.getElementById("replayDelYes")
    if (yes) {
      yes.addEventListener("click", function () {
        if (!pendingDeleteId) {
          closeDeleteConfirm()
          return
        }
        var id = pendingDeleteId
        closeDeleteConfirm()
        replayDelete(id)
          .then(function () {
            if (refreshList) refreshList()
          })
          .catch(function (err) {
            console.error("delete replay failed", err)
          })
      })
    }
  }

  // v1.2.12：恢复首页「查看回放」按钮（v1.2.11 #3 删除「我的回放」时误删了本按钮的绑定）。
  // 仅绑定首页 btnReplays + 回放列表 overlay；「我的回放」（关于页）按需求已删除，不再接线。
  function initReplays() {
    var homeBtn = $("btnReplays")
    var overlay = $("replayListOverlay")
    if (!overlay) return
    var listEl = $("replayList")
    var emptyEl = $("replayEmpty")

    Array.prototype.forEach.call(
      overlay.querySelectorAll("[data-close-replay]"),
      function (el) {
        el.addEventListener("click", function () {
          overlay.hidden = true
        })
      }
    )

    function renderList() {
      listEl.innerHTML = ""
      replayList()
        .then(function (items) {
          if (!items.length) {
            emptyEl.hidden = false
            return
          }
          emptyEl.hidden = true
          items.forEach(function (r) {
            var row = document.createElement("div")
            row.className = "replay-item"

            var info = document.createElement("button")
            info.type = "button"
            info.className = "replay-info"
            info.innerHTML =
              '<span class="replay-label">' +
              replayEscape(r.label || r.rule) +
              "</span>" +
              '<span class="replay-date">' +
              replayFmtDate(r.createdAt) +
              "</span>"
            info.addEventListener("click", function () {
              overlay.hidden = true
              navigateToReplay(r.compressed, r.rule)
            })

            var del = document.createElement("button")
            del.type = "button"
            del.className = "replay-del"
            del.textContent = "删除"
            // v1.5.5（#75）：删除前二次确认 —— 点击「删除」先弹确认框，
            // 点「确认删除」才真正落库，防单次误触直接删掉回放。
            del.addEventListener("click", function (e) {
              e.stopPropagation()
              openDeleteConfirm(r)
            })

            row.appendChild(info)
            row.appendChild(del)
            listEl.appendChild(row)
          })
        })
        .catch(function () {
          emptyEl.hidden = false
          emptyEl.textContent = "读取回放失败（当前环境可能不支持本地存储）。"
        })
    }

    if (homeBtn) {
      homeBtn.addEventListener("click", function () {
        overlay.hidden = false
        renderList()
      })
    }
    // v1.5.5（#75）：绑定删除确认弹窗按钮（一次即可，重复绑定防抖由 DOM 初始化顺序保证）
    bindDeleteConfirm(renderList)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()

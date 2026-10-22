# 官网场景视觉

2026-10-22。服主确认可米为常驻玩家和世界主形象，随后要求不要把全身立绘、角色设定页直接铺在首页。新版以可米生活其中的场景讲述世界：灯火村庄、田间日常、河边闲暇和组队遗迹。

## 图片与实现

- `paper/integrations/agent-portal/public/assets/scenes/lantern-village.webp`：本轮内置 imagegen 生成。灯火村庄、宫殿、浮空岛与走在回家路上的可米；首页使用完整横幅，手机裁切保留人物与村庄。
- `lantern-village-960.webp`：同一图片的手机派生尺寸，通过 `srcset` 选择，约 170KB。
- `together-into-ruins.webp`：本轮内置 imagegen 生成。战士、可米和牧师共同探索遗迹。
- `morning-in-the-fields.webp`、`afternoon-by-the-river.webp`：服主指定 NAS 宣传包白名单中、明确授权用于官网的种田与钓鱼场景。原 PNG 的 SHA256 与交接清单一致。
- 以上 WebP 仅做格式、尺寸和质量编码，原 PNG 私下保留于项目 `.local/art-originals` 和运维备份。网页图片总计约 1.64MB，首图之外懒加载。
- 全身立绘和设定页从首页移除。概念场景均有说明；女神相机展廊只使用游戏内 `published=true` 作品，保留原始 PNG、作者、题目与故事，不混入概念图。
- 宣传片手动播放、`preload=none`、手机内联播放；15 秒状态轮询只更新动态区域，保留视频元素及播放、暂停、拖动进度。

## 最终生成提示词

使用内置 imagegen；两次均仅把 `cormy-character-sheet.png` 作为人物外观参考，不沿用设定页构图。

### 灯火村庄

> Use case: stylized-concept. Create a NEW wide cinematic environment illustration for the Qiandengji (千灯纪) Minecraft RPG world homepage. The input is ONLY the identity and clothing reference for CorMy (可米), NOT a target layout. Transform this character reference into a rich inhabited world scene, NOT a character sheet or isolated portrait. Landscape 16:9, preferably 2048x1152. A walkable lantern-lit riverside village spreads across terraced grassy hills, stone paths and bridges, small wheat fields, an adventurers' guild and a distant majestic Chinese palace and floating island. Warm dusk with forest green, pale amber and parchment light. CorMy, the orange-white cat-eared resident in a cream adventurer jacket with small lantern and cat tail, is a SMALL natural figure on the foreground path (under 15 percent of image height), walking home with supplies; several tiny ordinary adventurers and villagers live in the town. Environment is the main subject. A real sense of a long-lived friendly world with farming, cooperation, exploration and home. Minecraft-inspired block geometry with beautiful painterly anime environmental lighting; coherent architectural scale, legible paths, lush atmospheric depth. Composition intended to sit beside webpage text: no baked text, no slogans, no logos, no UI, no watermarks, no collage, no reference-sheet panels, no oversized standing character, no close-up face. It is honest concept art, not a fake screenshot. Preserve CorMy's cream and orange-white visual identity from the reference while fully integrating her into the landscape.

### 结伴遗迹

> Use case: stylized-concept. Wide 16:9 cinematic environmental concept art for the Qiandengji Minecraft RPG website, preferably 2048x1152. Use the supplied character sheet only as identity reference for the orange-white cat-eared adventurer CorMy wearing a cream jacket, leather straps, small lantern, and cat tail. A small party of three companions is entering a magnificent mossy stone dungeon beneath an ancient Chinese-inspired ruined gate: a swordsman, CorMy with a softly glowing staff, and a healer casting a gentle protective ring around the party. The three characters are seen at medium distance in the lower third, integrated naturally into the landscape; the temple and underground hall are the main subject. Ancient voxel stairs, weathered pillars, vines, torchlight and soft cyan magical particles guide the eye into the underground entrance. A glimpse of enemies deep inside, no gore. A sense of discovery, teamwork, warm companionship, and an adventure that continues tomorrow. Minecraft-inspired block structure with polished painterly anime environment art, forest-green shadows, warm amber lanterns, restrained cyan skill light; visually compatible with the warm river-village concept art. No giant isolated character, no character-sheet layout, no infographic, no UI, no HUD, no text, no logos or watermarks. This is a world concept illustration, not a server screenshot.

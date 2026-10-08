# 资源来源与制作入口

运行登记唯一来源为 src/assets-manifest.js。运行路径与制作路径分别管理：前者必须入登记，后者保留当前可编辑源和实际重建依赖。本项目自有源代码的 MIT License 不替代模型、图片、音频与参考素材的许可。以下是现有来源记录，未知许可不推断为可自由分发。

| 当前资产 | 制作/原始文件与入口 | 来源及用途 |
| --- | --- | --- |
| 水田单牛曲木犁 | `paddy-ploughing/build.py` / `paddy-plough.blend`；运行 `src/assets/models/paddy-plough.glb` | 项目原创木轭、单根曲犁辕、犁柱/犁床/犁把及片状铁铧，保留独立可编辑源；柔性耕索与肩颈适配由运行时处理。默认独立母牛复用现有GLB，原牛与人物模型不重写。 |
| 营地烧火烹饪架 | `campsite-cooking-set/Campsite_Cooking_Set_Animated.glb` 原件；运行 `src/assets/models/campsite-cooking-set.glb` | 用户提供，作者及许可未附；保留内嵌贴图与 6 秒火焰、汤泡、蒸汽循环，放在僵尸牛栏西侧。 |
| 火影雕刻山 | mountain/six_hokage_mountain.glb 原件、hokage-mountain-complete.blend、surface.mjs、surface.json、build.py；运行 models/hokage-mountain.glb | jmartinez20592 的 Six Hokage Mountain，CC BY 4.0；保留雕刻/纹理，补齐侧背面、岩石坡脚、山顶与狼山路；署名随包保留于 HOKAGE-MOUNTAIN-CREDITS.md。 |
| 僵尸运牛木车及敞篷农场抓牛车 | `zombie-wood-cart/zombie-wood-cart.blend`、`build.py`、原创木纹；`build-crew.py` / `farm_cart.py` 派生 `zombie-crew-cart.blend` 与 `farm-wood-grain.png`。旧双人版另存 `zombie-crew-cart-wooden.blend` / `.glb`；旧 `zombie-wood-cart.glb` 保留在本来源目录、仅供兼容测试；运行资产为 `src/assets/models/zombie-crew-cart.glb` | 原版按用户三视图原创；新版按用户确认的概念原创制作低车头、开放驾驶区、圆灯/格栅、橡胶胎纹和金属轮毂，保留双人座位、木斗与可开合后栏板。 |
| surf-car-09、同车型 base | surf-car-09/ 两份 .blend、build_surf_car.py、reference-09.png | 项目 Blender 几何制作；用户参考图仅用于造型；唯一现车型及有效降级 |
| 五动物 rigged | 各 ID 静态/骨骼 .blend、build.py、rig.py；animals/ 共享模板及 profile | 项目几何与程序材质，依据用户形象需求；豹拉两张参考图只作外观对照，未知额外参考许可未推断 |
| sample-tree-02 | trees/sample-tree-02/sample-tree-02.blend、build.py；源目录 bark-colour-planes.png、stats.json | 项目确定性枝叶几何与树皮纹理，当前八棵树及远景带；共享叶材质在 src/tree-leaf.js |
| anime-tree | scripts/generate_anime_tree.py、scripts/export_anime_tree_forest.py、trees/anime-tree/anime-tree-lod.blend、stats.json | 当前 180 株树林；六个冠块实体叶、原创暖棕手绘树皮（内置 imagegen）、单树形三档 LOD。layered-canopy 前版制作源保留，停用的运行 GLB 已清理。 |
| reference-house | studies/reference-house.blend、House *.png、build_reference_house.py | 项目原创几何与确定性纹理，四栋乡间住宅 |
| 野原家住宅 | crayon_shin-chan_nohara_house.glb 原件、nohara-house/convert.mjs | sadraccoon03 的 Sketchfab 模型，CC BY-NC 4.0；原始说明见 src/assets/models/NOHARA-HOUSE-CREDITS.md |
| 地面 grass-earth-user.png | closeup/grass-earth-user-original.png；现运行副本 | 用户提供，未附额外许可资料；当前草土颜色贴图，保留原始图 |
| water-pebbles | water/water-pebbles.blend、build.py；运行 models/water-pebbles.glb | 项目原创四种暖色圆润卵石；水渠实例化，砂底、泥底和水纹由 water-bed.js / water-reflections.js 制作 |
| canal-goldfish | canal-goldfish/build.py、静态/骨骼 .blend、validation.json | 项目原创八骨骼小金鱼；五条游动鱼，橙金与红白顶点绘色，共用真实蒙皮几何 |
| PvZ 三僵尸 | PvZ_Zombie/ 三个原始 GLB、convert.mjs；运行 models/pvz-zombies/ | 用户提供 Sketchfab 导出模型，原作者/下载地址/许可未知；已有蒙皮无动画，独立程序双足拖步，原 BIN 原样保留，仅迁移旧材质 |
| summer-cloud-atlas-v2、summer-mountains-v2 | src/assets/ 当前 PNG | 历史制作记录为 imagegen 为项目生成；用于世界空间远云/山，不是整屏背景 |
| Easy Lemon | src/assets/audio/easy-lemon.mp3、CREDITS.md | Kevin MacLeod，CC BY4.0；原下载/署名记录随包保留 |
| Dream Culture | audio/dream-culture.mp3 原件与同名运行副本、CREDITS.md | Kevin MacLeod，CC BY4.0；2026-10-03 从官方网站下载，原样保留；黑夜背景音乐，昼夜交叉淡化及暂停面板署名。 |
| 僵尸No叫声 | audio/zombies_noooomp.mp3 原件与同名运行副本 | 用户提供，未改字节；动物完整出栏时僵尸喊No，许可资料未附。 |
| 房屋及动物声音 | audio/ 原始 MP3/WAV 与运行副本 | 用户提供，原样复制；未附额外许可信息；具体映射见登记和音频 credits |
| 路面、草、秧苗、花、灌木、石岸、水面 | src 中确定性几何/Canvas/材质与反射代码 | 项目程序制作，制作不依赖外部图像模型 |
| Three.js | package-lock 固定0.180.0，node_modules/three/LICENSE | MIT；随发布包含许可；未使用的 vendor 副本已删除 |

## 其他导入资源

- Jabami Anime Tree v2：原件位于 `trees/jabami-anime-tree-v2/jabami-anime-tree-v2.glb`。元数据作者为 JABAMI Production，许可标签为 Sketchfab Standard；原始来源与许可链接见 `src/assets/trees/jabami-anime-tree-v2/CREDITS.md`。
- 小白：运行文件为 `src/assets/models/shinchan/Shiro_Rigged.glb`，现有来源记录未附明确许可。
- 旗帜僵尸旗子：原件为 `pvz-flagbearer/flag-zombie-original.glb`，制作入口为 `build.mjs`。元数据标注 Nazar Okruzhko，CC BY 4.0；署名及组合改动见 `src/assets/models/pvz-zombies/FLAG-CREDITS.md`。

## 制作与分发

动物 `build.py` 生成静态 Blender 源，`rig.py` 使用共享工具导出运行 GLB。保留静态源，再验证实际骨骼与蒙皮；运行模型不能代替可编辑源。

公开分发前需逐项确认上述非商业、Sketchfab Standard 和许可未知的资源。现有资源保持原字节，许可未确认的条目不会因加入本清单而获得新的授权。

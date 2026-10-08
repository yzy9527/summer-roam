# 开发说明

## 目录

| 目录 | 用途 |
| --- | --- |
| `src/` | 游戏源码、HTML、样式及运行资源 |
| `src/app/` | 输入、镜头、车辆显示、音频接线和诊断快照 |
| `src/gameplay/` | 抓牛、救援、耕作与任务所有权模块 |
| `src/assets/` | 游戏实际加载的模型、图片、音频和署名文件 |
| `assets-source/` | 原始模型、可编辑 Blender 源、制作脚本和纹理 |
| `scripts/` | 构建资源清单、发布校验和资源制作工具 |
| `tests/` | 单元、实际模型和玩法集成测试 |

## 修改与验证

使用 `npm run test:unit` 做快速回归，提交前运行 `npm run verify`。JavaScript / MJS 使用 Prettier 和 ESLint。

`npm test` 会读取 `assets-source/` 中的原始模型、音频及可编辑源。保留这些文件，不能仅复制 `src/` 后运行完整测试。

动物源文件按物种目录存放：`build.py` 制作静态源，`rig.py` 接入 `assets-source/animals/` 的共享骨骼工具。制作脚本在 Blender 的 Python 环境中执行；先保留静态源，再检查导出的骨骼、蒙皮和运行效果。模型修改需要实际 GLB 测试及浏览器验收，Node 测试不能代替渲染检查。

## 资源接入

`src/assets-manifest.js` 是运行资源的登记入口。新增模型、纹理或声音时，同时维护运行文件、源文件、来源与许可记录。构建只发布登记的运行资源，不复制整个制作目录。

旧木车等资产由 `tests/compatibility/` 使用，不属于正式游戏入口。保留其测试依赖。

## 浏览器诊断

普通入口提供 `window.__seaside.snapshot()`。使用 `/?qa=1` 开启 QA；抓牛流程可用 `/?qa=1&heistview=1`，耕田可用 `/?qa=1&ploughview=overview`。诊断快照用于查看当前状态，实际操作与暂停恢复仍需在浏览器中验证。

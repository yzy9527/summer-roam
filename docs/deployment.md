# 构建与部署

```sh
npm ci
npm run verify
npm run build
npm run preview
```

构建结果位于 `dist/`。将其中全部文件上传至静态站点并保留相对目录，支持站点根目录或子目录部署。源码、测试、模型制作源和日志不进入站点构建。

## 资源与缓存

`src/assets-manifest.js` 是运行资源登记表，`scripts/release-assets.mjs` 生成构建白名单。构建根据全部登记资源的内容计算版本目录，原样复制模型、纹理、音频和署名文件，并附带 Three.js 许可。

资源变化会生成新的版本目录。部署时同时更新 HTML、JS、CSS 和对应资源目录；避免只上传入口文件。发布校验仅检查文件、字节和体积预算，不代表已经确认全部第三方素材的分发授权。

## 自定义输出目录

```sh
npx vite build --outDir ../output/site-preview
node scripts/verify-release.mjs output/site-preview
```

Vite 的相对输出路径以 `src/` 为基准，校验器参数以项目根目录为基准。资源插件跟随最终输出目录。

## 发布检查与压缩包

预算定义在 `scripts/release-policy.mjs`：文件数不超过 58，总体积不超过 224 MiB，JS / CSS 不超过 1048 KiB。默认构建会自动运行发布校验，也可运行 `npm run verify:release`。

安装系统 `zip` 命令后，可运行 `npm run package`，生成 `output/release/summer-roam-oss.zip`。压缩包包含构建站点；解压后上传其中全部内容。

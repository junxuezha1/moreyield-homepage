# Moreyield 个人主页

线上网站：[moreyield.cn](https://moreyield.cn/)

这是完整个人网站的独立仓库，包含风景主页、四篇完整文章、Workbench 产品介绍和可游玩的像素世界。源文件与 2026-09-24 发布的第十三版网站一致。HTML、CSS、业务 JavaScript 与素材都保存在仓库中，可以直接修改；Phaser 引擎是预构建的第三方依赖。

## 本地运行

使用 Node.js 20 或更新版本，不需要安装 npm 依赖。

```sh
npm run dev
```

打开 <http://127.0.0.1:4191/>。端口已占用时，可运行 `PORT=4193 npm run dev`。请通过本地 HTTP 服务访问，以便项目详情与游戏正确读取 JSON 和 JavaScript 模块。

```sh
npm run check    # 检查文件清单和站内引用
npm run build    # 生成可直接部署的 dist/
npm run preview  # 在相同端口预览 dist/
```

## 内容结构

| 位置 | 内容 |
| --- | --- |
| `site/index.html` | 个人主页与统一记录列表 |
| `site/styles.css`、`site/app.js` | 主页样式和交互 |
| `site/projects.json` | 项目详情与外部项目入口 |
| `site/articles/`、`site/article.css` | 完整文章和阅读样式 |
| `site/assets/` | 首页风景、封面和文章配图 |
| `site/products/workbench/` | 原 Workbench 介绍、截图和视频 |
| `site/world/` | 像素游戏、场景素材、对话与 Phaser 引擎 |
| `site-files.json` | 公开站点文件清单，构建和预览共用 |
| `scripts/` | 无外部依赖的检查、构建与预览脚本 |

添加文章时，在 `site/articles/` 创建 HTML，将封面放进 `site/assets/articles/`，在首页记录列表添加入口，并将新增文件加入 `site-files.json`。图片用相对路径引用，X 首发链接仅作为文末来源。记录缩略图与文章封面均保留完整构图。

游戏入口为 `/world/`，游戏内可返回主站。游戏脚本位于 `site/world/src/` 与 `site/world/stages/`，公开对话和作品信息位于 `site/world/src/content/`。游戏源码与运行素材均在当前仓库内，无需另外获取原工作区。

## 部署

构建后只发布 `dist/`。现有网站托管在 Cloudflare Pages 的 `moreyield` 项目，生产分支为 `main`。使用已经授权的 Cloudflare 账户手动发布：

```sh
npm run build
npx wrangler pages deploy dist --project-name moreyield --branch main
```

根域名与 www 沿用现有托管配置。本仓库不会自动修改线上网站或域名；GitHub Actions 仅执行构建检查。如果以后配置 Cloudflare Git 集成，构建命令使用 `npm run build`，输出目录使用 `dist`。

仓库只包含网站和维护工具，不包含原工作区的其他项目、凭据、运行日志、历史备份或发布 ZIP。`dist/` 是生成目录，不提交到 Git。

## 素材与依赖

Phaser 的许可保存在 `site/world/vendor/PHASER-LICENSE.txt`，游戏素材署名保存在 `site/world/public/assets/landmarks/credits.html`。文章与图片沿用网站现有内容；本仓库没有为全部内容授予统一的开源许可。

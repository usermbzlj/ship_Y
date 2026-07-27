# 本地开发与文件归属

本地仓库是《远穹》的最高优先级事实源。开发、检查、存档兼容和文档更新都先在本地完成；线上部署只能由已验证的本地版本单向生成。

## 环境与启动

- Node.js `>= 22.13.0`
- npm
- PowerShell、Windows Terminal 或其他常规终端

```powershell
npm install
npm run check:env
npm run dev
```

需要由本地启动器装载 DeepSeek 配置时，使用：

```powershell
npm run dev:deepseek
```

Windows PowerShell 备选入口为 `npm run dev:deepseek:ps1`。

## 配置与密钥

以下文件都属于本机私有资料，已被 Git 忽略，不得复制到文档、截图、前端代码或提交记录中：

| 文件 | 作用 |
|---|---|
| `.env.local` | 本地环境变量与服务端密钥 |
| `config/llm.local.json` | 本地完整 LLM 端点、模型和映射配置；供检查或手动导入 `LLM_CONFIG_JSON`，运行时不会仅因文件存在而自动加载 |
| `deepseek-credentials.txt` | `start-deepseek.mjs` 可自动发现的本地启动凭据 |
| `.openai/hosting.json` | 本机 Sites 项目标识，不是产品源码 |

可提交的模板只有 `.env.example` 与 `config/llm.example.json`。模板只保留变量名、无效示例端点和占位内容，不得含真实密钥。`npm run check:env` 只报告就绪状态，不打印密钥值。

## 目录归属

| 类别 | 路径 | 处理原则 |
|---|---|---|
| 产品源码 | `app/`、`lib/`、`worker/` | 必须纳入版本控制 |
| 仿真与 LLM | `lib/sim/`、`lib/llm/`、`lib/astro/` | 权威物理域、Prompt、星表 |
| 本地存档 | `lib/persist/` | IndexedDB 手动单槽（`local-save-idb.ts`）与 LS 迁移/回退 |
| 构建工具源码 | `build/sites-vite-plugin.ts`、根目录配置文件 | `build/` 中这一项是源码，不是生成物 |
| 配置模板 | `.env.example`、`config/llm.example.json` | 可提交，只含安全示例 |
| 运维脚本 | `scripts/`（含 `check-docs.mjs`） | 可提交，并保持跨平台入口清晰 |
| 自动化验证 | `tests/` | 可提交；行为变化应同步测试 |
| 项目文档 | `README.md`、`docs/` | 可提交；历史视觉证据放入 `docs/archive/` |
| 静态资源 | `public/` | 可提交 |
| 生成物 | `dist/`、`.vinext/`、`.wrangler/`、`tsconfig.tsbuildinfo` | 不提交，可重新生成 |
| 依赖缓存 | `node_modules/` | 不提交，由 `npm install` 恢复 |
| 本机工具状态 | `.qoder/`、`.openai/` | 不提交，不作为产品事实源 |

不要把 `build/` 整体当成可删除目录：`build/sites-vite-plugin.ts` 被 `vite.config.ts` 直接引用。旧版 QA 图片已移到 `docs/archive/legacy-ui/`，避免和当前构建工具混放。

## 本地质量门禁

```powershell
# 文档链接、版本摘要（与代码对照）、过时措辞、示例配置和敏感文件跟踪
npm run check:docs

# TypeScript 与 ESLint
npm run typecheck
npm run lint

# 生产构建
npm run build
npm run start

# 单元测试；Worker 综合测试可能需要数分钟
npm run test:unit

# 完整门禁：文档、类型、Lint、构建和测试
npm run check
```

`npm run check:docs`（`scripts/check-docs.mjs`）会核对 Markdown 链接、`PROJECT_STATUS` 版本表与源码常量一致，并拦截当前态文档里过时的运行时版本声称，以及把手动 IDB 存档误写成「尚未落地」之类的假事实。

`npm run start` 通过 `scripts/start-production.mjs` 启动 vinext 生产服务。该入口保留 vinext 的生产环境变量加载和服务端行为，同时临时修正 vinext `0.0.50` 在 Windows 上用反斜杠建立静态资源缓存键、导致 `/assets/*` 返回 `404` 的问题；依赖升级并确认上游修复后可移除这层兼容代码。

只修改文档时至少运行 `npm run check:docs`。改动脚本、配置或界面说明时，还应运行类型检查、Lint 和生产构建。物理域、存档或 Worker 行为变化必须运行对应测试；发布前再运行完整门禁。

## 安全整理原则

- 整理前先用 `git status --short` 区分源码、用户改动和生成物。
- 不删除或移动本机密钥文件；启动脚本依赖其固定发现路径。
- 不用线上副本覆盖本地工作树。
- 生成目录可以在确认路径后重新生成，但不得把仓库根目录或 `build/` 当作清理目标。
- UI 截图必须标注日期或版本；不再代表当前实现时移入 `docs/archive/`。

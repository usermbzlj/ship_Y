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

Windows 上也走同一 Node 入口；不再维护单独的 PowerShell 启动脚本。

## 日志与故障定位

`npm run dev`、`npm run dev:deepseek` 和 `npm run start` 都会在 `logs/` 下建立本次会话文件，并刷新 `logs/latest.log`。目录已被 Git 忽略。查看最近 200 行：

```powershell
npm run logs:latest
```

需要更多或更少记录时，在 `.env.local` 调整：

```dotenv
LOG_LEVEL=debug
NEXT_PUBLIC_LOG_LEVEL=info
```

允许值为 `debug`、`info`、`warn`、`error`、`silent`。服务端输出单行 JSON，字段含时间、级别、作用域、事件和请求关联 ID；浏览器输出保留最近 `500` 条脱敏记录。开发者工具控制台可用 `window.__FAR_HORIZON_DIAGNOSTICS__.getLogs()` 查看，或调用 `downloadLogs()` 导出 NDJSON。

应用侧结构化 JSON 日志在写出时已按字段脱敏：只记录操作类型、状态、耗时、调用 ID 和错误对象，不记录 LLM Prompt、HTTP 正文、Authorization、Cookie、API Key、凭据或世界上下文。排查一次 LLM 故障时，用响应头或浏览器日志里的 `requestId` 搜索 `logs/latest.log`，即可串起浏览器请求、服务端路由、模型调用与重试。

注意：`logs/*.log` 是启动入口对子进程 stdout/stderr 的原始 tee（含 vinext、堆栈等），其中仍可能出现明文；不要把磁盘会话日志说成「已全部自动脱敏」。

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
| 本地存档 | `lib/persist/` | IndexedDB 手动槽 + 轮换自动槽、checksum（`local-save-idb.ts` / `local-save-checksum.ts`）与 LS 迁移/回退 |
| 构建工具源码 | `build/sites-vite-plugin.ts`、根目录配置文件 | `build/` 中这一项是源码，不是生成物 |
| 配置模板 | `.env.example`、`config/llm.example.json` | 可提交，只含安全示例 |
| 运维脚本 | `scripts/`（含 `check-docs.mjs`） | 可提交，并保持跨平台入口清晰 |
| 本地运行日志 | `logs/` | 自动生成，不提交；`latest.log` 指向本次启动输出 |
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

# 日常回归（`npm test` / `npm run test:unit` / `npm run check` 同用此快套件）；排除 4 个超重 Worker / 长航程文件；并发 4
npm run test:fast
# `npm run test:unit` 是 test:fast 的别名，不是全量套件

# 只跑 4 个超重文件并保持串行，便于定位长算例
npm run test:heavy

# 生产构建后再跑全部 Node 测试（含超重；可能数分钟以上）
npm run test:full

# 日常完整门禁：文档、类型、Lint、构建 + test:fast
npm run check

# 发布前门禁：在 check 之上再跑 test:heavy
npm run check:release
```

`npm run check:docs`（`scripts/check-docs.mjs`）会核对 Markdown 链接、`PROJECT_STATUS` 版本表与源码常量一致，并拦截当前态文档里过时的运行时 / LocalSave 版本声称，以及把手动 IDB 存档误写成「尚未落地」之类的假事实。

`npm run start` 通过 `scripts/start-production.mjs` 启动 vinext 生产服务，**默认监听 `127.0.0.1`**，使 UI 来源与 LLM 写路由的回环信任（`assertTrustedLocalRequest`）一致。若需局域网访问可传 `--hostname=0.0.0.0`（或 `HOST=`），但浏览器仍须经 `localhost` / `127.0.0.1` 打开页面才能调用 invoke 等写路由，否则会 403。该入口保留 vinext 的生产环境变量加载和服务端行为，同时临时修正 vinext `0.0.50` 在 Windows 上用反斜杠建立静态资源缓存键、导致 `/assets/*` 返回 `404` 的问题；依赖升级并确认上游修复后可移除这层兼容代码。

只修改文档时至少运行 `npm run check:docs`。改动脚本、配置或界面说明时，还应运行类型检查、Lint 和生产构建。物理域、存档或 Worker 行为变化必须运行对应测试；日常用 `test:fast` / `check`，发布前再跑 `test:heavy` / `check:release`。

## 安全整理原则

- 整理前先用 `git status --short` 区分源码、用户改动和生成物。
- 不删除或移动本机密钥文件；启动脚本依赖其固定发现路径。
- 不用线上副本覆盖本地工作树。
- 生成目录可以在确认路径后重新生成，但不得把仓库根目录或 `build/` 当作清理目标。
- UI 截图必须标注日期或版本；不再代表当前实现时移入 `docs/archive/`。

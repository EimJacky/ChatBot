# Discord AI 群聊机器人开发实施计划

## Summary
构建工业级本地 MVP：Node.js + TypeScript + `discord.js` v14，接入 OpenAI 兼容接口。主入口为 slash commands，`@mention` 可选增强；内置手动 DI、启动时依赖校验、配置校验、Prompt Guard、结构化日志、上下文管理、token 裁剪、限流、流式回复、健康检查、管理调试命令和测试体系。

## Key Changes
- 初始化 git、npm、TypeScript、ESLint、Prettier、Vitest、Husky、lint-staged。
- 依赖：`discord.js`、`openai`、`dotenv`、`zod`、`pino`、`pino-pretty`、`bottleneck`、`gpt-tokenizer`、`lru-cache`。
- 核心目录：
  - `src/application/`：chat use case 与业务编排。
  - `src/config/`：env schema、模型配置、Prompt Guard 规则加载、手动 DI 工厂、`validateContainer()`。
  - `src/services/ai/`：OpenAI 兼容调用、重试、fallback、stream、Prompt Guard。
  - `src/services/context/`：`ContextManager`、token 裁剪、LRU/TTL、`compress()`、`getStats()`。
  - `src/services/discord/`：`StreamingMessageHandler`、Discord REST 全局限流。
  - `src/services/rateLimit/`：用户、频道、mention 每日限流。
  - `src/utils/`：logger、错误归一化、文本清理、全局错误处理。
- 配置文件：
  - `.env.example`：Discord、AI、模型、限流、日志、mention、健康检查、owner id、上下文配置。
  - `prompts/system.md`：系统提示词。
  - `config/prompt-guard-rules.json`：Prompt Guard 拒绝规则。

## Implementation
- Discord：
  - 命令：`/chat`、`/reset`、`/stats`、`/ping`、`/models`、`/debug`。
  - `/debug` 仅允许 `BOT_OWNER_ID` Set 命中的用户使用，显示内存、活跃频道数、上下文统计、限流状态，不暴露密钥或完整 prompt。
  - `/models` 显示当前模型、fallback、temperature、max tokens、上下文窗口。
  - `@mention` 由 `ENABLE_MENTION_TRIGGER` 控制，并受每日 mention 总量限制。
- AI 与安全：
  - OpenAI SDK + `baseURL`，支持主模型、fallback 模型、流式和非流式降级。
  - 429、超时、网络错误有限重试；鉴权和模型错误直接失败。
  - Prompt Guard 固定 system prompt 首位、隔离用户内容、拒绝覆盖系统指令类请求，并记录审计日志。
  - 流式最大等待默认 60 秒；消息编辑通过 Bottleneck 全局限流，默认 1 秒节流。
- Context：
  - 使用 `lru-cache` 管理频道上下文，按 TTL 清理不活跃频道。
  - 使用 `gpt-tokenizer` 估算 token，先 token 预算裁剪，再消息数裁剪。
  - `compress()` v1 默认保留最近 N 轮；`getStats()` 供 `/stats`、`/debug`、`/healthz` 使用。
- 运维：
  - 启动时执行 `validateContainer()`，确保关键服务全部注入。
  - `pino` 结构化日志，开发环境 pretty console；长期运行默认 stdout，可配置 file destination。
  - `HEALTH_CHECK_PORT=0` 默认关闭；设置端口后仅绑定 `127.0.0.1` 提供 `/healthz`。
  - 捕获 `unhandledRejection`、`uncaughtException`，处理 `SIGINT/SIGTERM` graceful shutdown。
  - 每小时记录一次 `process.memoryUsage()`。

## Test Plan
- 单元测试：config、models、DI container validation、Prompt Guard、对抗性 prompt、ContextManager、token 裁剪、LRU/TTL、`compress()` snapshot、rate limiter、AI retry/fallback、StreamingMessageHandler。
- 集成测试：mock Discord interaction/message event，覆盖 `/chat`、`@mention`、`/debug` owner 校验、错误降级、限流、健康检查。
- Load Test：模拟 50 个并发混合请求，包括正常 `/chat`、恶意 prompt、超长输入和限流命中，验证稳定性和无未处理异常。
- 本地验收：
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run register`
  - `npm run dev`
  - Discord 测试服务器验证所有命令、连续追问、流式回复、限流和 `@mention` 降级。

## Assumptions
- 允许初始化 git 并启用 Husky hooks。
- 使用 npm，不切换 pnpm/yarn。
- 第一版仅本地长期运行，不加入 Docker、Redis、数据库、Sentry、管理后台或内容安全模型。
- 上下文仅内存保存，重启后丢失。
- DI 工厂中保留注释，标明未来可替换为事件总线。
- 自适应流式节流、配置热重载、日志轮转包、NSFW/内容安全模型作为 v1.1 扩展点。

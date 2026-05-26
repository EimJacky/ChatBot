# EchoMate Discord AI Chat Bot

EchoMate is a TypeScript Discord AI group chat bot built with `discord.js` v14 and an OpenAI-compatible chat API. It is designed as a local, maintainable MVP with slash commands, optional mention replies, short-term channel memory, rate limiting, structured logs, prompt guard rules, and health diagnostics.

## Features

- Slash commands: `/chat`, `/reset`, `/stats`, `/ping`, `/models`, `/debug`
- Optional `@EchoMate` mention trigger
- OpenAI-compatible API support via `AI_BASE_URL`
- Provider strategy support for MiMo Web Search and plain OpenAI-compatible APIs
- Optional app-side Tavily web search with prompt injection
- Streaming AI replies with throttled Discord message edits
- Per-user and per-channel rate limits
- Daily mention limit
- Channel-scoped in-memory context with LRU + TTL cleanup
- Token estimation with `gpt-tokenizer`
- Prompt Guard rules loaded from `config/prompt-guard-rules.json`
- Owner-only `/debug` diagnostics
- Optional local `/healthz` endpoint
- ESLint, Prettier, Vitest, Husky, lint-staged

## Requirements

- Node.js 20+
- npm
- A Discord application and bot token
- An OpenAI-compatible API key and model
- Network access to Discord. In restricted networks, enable TUN mode or configure a working proxy.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from the example:

```bash
copy .env.example .env
```

Fill in the required values:

```env
DISCORD_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
BOT_OWNER_ID=your-discord-user-id

AI_BASE_URL=https://your-openai-compatible-api/v1
AI_API_KEY=your-api-key
AI_MODEL=your-model-name
AI_PROVIDER=auto
```

For example:

```env
AI_BASE_URL=https://api.xiaomimimo.com/v1
AI_MODEL=mimo-v2.5-pro
```

If a real API key was ever committed or shared, rotate it in the provider console.

## Provider and Web Search

EchoMate can keep standard OpenAI-compatible requests for most providers, and enable MiMo's server-managed Web Search when the configured base URL is MiMo.

```env
AI_PROVIDER=auto
AI_WEB_SEARCH_ENABLED=true
AI_WEB_SEARCH_MODE=auto
AI_WEB_SEARCH_MAX_KEYWORD=5
AI_WEB_SEARCH_LIMIT=3
AI_THINKING_TYPE=disabled
AI_SHOW_SEARCH_ANNOTATIONS=false
AI_NOTIFY_SEARCH_DOWNGRADE=true
```

Provider options:

- `auto`: detect MiMo from `AI_BASE_URL`, otherwise use standard OpenAI-compatible behavior.
- `mimo`: force MiMo provider extensions.
- `openai-compatible`: send standard Chat Completions parameters only.
- `standard`: disable all provider extensions for compatibility troubleshooting.

MiMo Web Search notes:

- Enable the Web Search Plugin in the MiMo Console before using it.
- Plugin enable/disable changes can take a few minutes to take effect.
- Search can add latency and provider-side cost.
- Search failures are downgraded once to a no-search answer so Discord users still get a response.
- Raw search results and annotations are not saved in conversation context.

## App-Side Web Search

If you do not want to pay for MiMo's native Web Search plugin, EchoMate can call Tavily itself and inject compact search snippets into the current prompt. This mode is mutually exclusive with MiMo native search.

```env
AI_WEB_SEARCH_ENABLED=false
SEARCH_ENABLED=true
SEARCH_PROVIDER=tavily
SEARCH_API_KEY=your-tavily-key
SEARCH_RESULT_LIMIT=2
SEARCH_CACHE_TTL_MS=300000
SEARCH_RATE_LIMIT_MAX=10
SEARCH_RATE_LIMIT_WINDOW_MS=60000
SEARCH_DAILY_LIMIT=100
SEARCH_DAILY_WARNING_RATIO=0.8
SEARCH_LLM_INTENT_ENABLED=false
SEARCH_SHOW_SKIP_REASON=false
SEARCH_PROGRESS_NOTICE=true
```

App-side search notes:

- MiMo native search wins when both `AI_WEB_SEARCH_ENABLED=true` and `SEARCH_ENABLED=true`.
- Search results are temporary context for one reply only; they are not saved to channel memory.
- Cache hits do not consume per-user search limits or the global daily budget.
- Tavily calls can add latency and consume provider quota; `/debug` shows usage diagnostics.
- `SEARCH_LLM_INTENT_ENABLED=true` enables a low-token yes/no classifier for ambiguous prompts.

## Discord Configuration

In the Discord Developer Portal:

1. Create an application.
2. Add a bot and copy its token.
3. Copy the Application ID into `DISCORD_CLIENT_ID`.
4. Enable **Message Content Intent** only if you want `@mention` replies.
5. Invite the bot with these scopes:
   - `bot`
   - `applications.commands`
6. Grant minimal permissions:
   - `Send Messages`
   - `Use Slash Commands`
   - Optional: `Read Message History`
7. Leave **Interactions Endpoint URL** empty for this Gateway-based bot.

## Register Commands

Register slash commands to the configured test guild:

```bash
npm run register
```

If Discord is unreachable from your network, use a proxy or TUN mode. With PowerShell:

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
npm run register
```

## Run Locally

```bash
npm run dev
```

With a proxy:

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
npm run dev
```

When startup is healthy, logs should include:

```text
discord shard ready
discord bot is ready
runtime AI configuration
```

## Diagnostics

Check whether the bot token, application ID, guild ID, and AI settings are wired correctly:

```bash
npm run doctor
```

Expected important line:

```text
Client ID matches token application: true
```

## Scripts

```bash
npm run dev         # Start the bot in watch mode
npm run register    # Register Discord slash commands
npm run doctor      # Diagnose Discord token/client configuration
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript checks
npm test            # Run Vitest
npm run build       # Compile TypeScript
```

## Project Structure

```text
src/
├── application/       # Chat use case orchestration
├── commands/          # Slash command definitions and handlers
├── config/            # Env schema, model defaults, DI container
├── events/            # Discord event handlers
├── health/            # Optional local health server
├── services/
│   ├── ai/            # AI service and Prompt Guard
│   ├── context/       # ContextManager and tokenizer
│   ├── discord/       # Streaming reply handler
│   └── rateLimit/     # User/channel/mention limiters
├── types/
└── utils/
```

## Notes

- `.env` is ignored by git. Do not commit real Discord or AI keys.
- `DISCORD_GUILD_ID` is recommended during development because guild commands update quickly.
- Global command registration is supported when `DISCORD_GUILD_ID` is empty, but Discord propagation can be slow.
- MiMo Web Search is supported through the provider strategy layer. Other providers keep standard OpenAI-compatible behavior unless an adapter is added.

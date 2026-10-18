# Enterprise Multi-Agent Code Review Orchestrator
 
A TypeScript orchestrator built on the Claude Agent SDK. It reviews GitHub pull requests using three parallel subagents and produces Markdown, HTML and JSON reports.
 
## Architecture
- **Orchestrator** (`src/orchestrator.ts`): fetches PR files through the GitHub MCP server, delegates analysis with the `Task` tool and validates the final structured output with Zod (`ReviewReportSchema`).
- **Subagents** (`src/agents/`): each one is limited to the `Read`, `Grep`, `Glob` and `Skill` tools.
  - `code-quality-analyzer`: finds issues, scores quality and uses the javascript-best-practices skill.
  - `test-coverage-analyzer`: finds untested paths and prioritizes tests.
  - `refactoring-suggester`: suggests refactorings.
- **MCP servers** (`src/config/mcp.config.ts`): GitHub (`@modelcontextprotocol/server-github`) and ESLint (`@eslint/mcp`).
- **Structured output**: `outputFormat: json_schema` built from Zod with `zod-to-json-schema`.
- **Reliability** (`src/utils/`):
  - Rate limiter: concurrency, requests per minute and tokens per minute.
  - `withRetry`: exponential backoff with jitter.
  - `withTimeout`: stops a review that runs too long.
  - Typed `ReviewError` codes for clear failure reasons.
- **Reports** (`src/utils/report-generator.ts`): saved to `reports/` as Markdown, HTML and JSON.
 
## Setup
```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY (or AWS Bedrock vars), ANTHROPIC_MODEL, optional GITHUB_TOKEN
```

## Usage
    npm run dev -- <owner> <repo> <prNumber>
    npm run dev -- udacity cd14715-simple-todo-app 1

Reports are saved to reports/<owner>_<repo>_<pr>.md, .html and .json

## Testing
    npm run build
    npm test

## Results
PRs 1, 2 and 3 of udacity/cd14715-simple-todo-app were reviewed (9 reports in reports/).

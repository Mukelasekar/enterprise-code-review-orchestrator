import { query } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import type { ReviewReport } from './types/report-types';
import { mcpServersConfig } from './config/mcp.config.js';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { RateLimiter, DEFAULT_RATE_LIMITS } from './utils/rate-limiter.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError } from './utils/error-handler.js';
import { logger } from './utils/logger.js';
 
/**
* Orchestrator configuration options
*/
export interface OrchestratorOptions {
  /** Custom rate limits (merged with defaults) */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Maximum agent turns for the orchestrator */
  maxTurns?: number;
  /** Model to use (defaults to ANTHROPIC_MODEL) */
  model?: string;
  /** Timeout for a full review in milliseconds */
  timeoutMs?: number;
  /** Number of attempts for a review */
  maxRetries?: number;
}
 
/** Tools the orchestrator may use (least privilege) */
export const ORCHESTRATOR_ALLOWED_TOOLS = [
  // Subagent delegation
  'Task',
  // Skills + read-only file access
  'Skill',
  'Read',
  'Grep',
  'Glob',
  // GitHub MCP tools
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_pull_request_diff',
  'mcp__github__get_file_contents',
  // ESLint MCP tools
  'mcp__eslint__lint-files',
];
 
/**
* Main Code Review Orchestrator
* Coordinates subagents to analyze pull requests and generate comprehensive reports
*/
export class CodeReviewOrchestrator {
  private readonly rateLimitConfig: RateLimiterConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly maxTurns: number;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
 
  constructor(options: OrchestratorOptions = {}) {
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMITS, ...(options.rateLimits ?? {}) };
    this.rateLimiter = new RateLimiter(this.rateLimitConfig);
    this.maxTurns = options.maxTurns ?? 50;
    this.model = options.model ?? process.env.ANTHROPIC_MODEL;
    this.timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    this.maxRetries = options.maxRetries ?? 2;
  }
 
  /** Current configuration (useful for tests) */
  getConfig() {
    return {
      rateLimits: { ...this.rateLimitConfig },
      maxTurns: this.maxTurns,
      model: this.model,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
    };
  }
 
  /** Current rate limiter status */
  getRateLimiterStatus() {
    return this.rateLimiter.getStatus();
  }
 
  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    if (!owner || !repo || !Number.isInteger(prNumber) || prNumber <= 0) {
      throw new ReviewError('Invalid pull request reference', ErrorCodes.INVALID_CONFIG, {
        owner,
        repo,
        prNumber,
      });
    }
 
    const startTime = Date.now();
    logger.info(`Starting review of ${owner}/${repo}#${prNumber}`);
 
    await this.rateLimiter.acquire(20000);
    try {
      const report = await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} timed out`
          ),
        this.maxRetries,
        2000
      );
 
      report.metadata = {
        ...report.metadata,
        analyzedAt: report.metadata?.analyzedAt || new Date().toISOString(),
        duration: Date.now() - startTime,
      };
 
      logger.info(`Review completed in ${Math.round((Date.now() - startTime) / 1000)}s`);
      return report;
    } catch (error) {
      logger.error(`Review failed: ${formatError(error)}`);
      throw error;
    } finally {
      this.rateLimiter.release();
    }
  }
 
  /**
   * Run a single orchestrated review with the Agent SDK
   */
  private async runReview(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const prompt = buildOrchestratorPrompt(owner, repo, prNumber);
 
    const options: Record<string, unknown> = {
      model: this.model,
      cwd: process.env.PROJECT_ROOT || process.cwd(),
      settingSources: ['project'], // loads .claude/skills
      mcpServers: mcpServersConfig,
      agents: {
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester,
      },
      allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
      maxTurns: this.maxTurns,
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema,
      },
    };
 
    const stream = query({
      prompt,
      options: options as Parameters<typeof query>[0]['options'],
    });
 
    let structuredOutput: unknown;
    let resultText: string | undefined;
 
    for await (const message of stream) {
      const msg = message as any;
 
      if (msg.type === 'assistant') {
        const content = msg.message?.content ?? [];
        for (const block of content) {
          if (block?.type === 'tool_use') {
            const detail = block.name === 'Task' ? ` -> ${block.input?.subagent_type ?? ''}` : '';
            logger.info(`Tool call: ${block.name}${detail}`);
          }
        }
      }
 
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          structuredOutput = msg.structured_output;
          resultText = typeof msg.result === 'string' ? msg.result : undefined;
        } else {
          throw new ReviewError(`Agent run failed: ${msg.subtype}`, ErrorCodes.AGENT_FAILED, {
            subtype: msg.subtype,
          });
        }
      }
    }
 
    // Fallback: try to parse JSON from the final text result
    if (structuredOutput === undefined && resultText) {
      try {
        structuredOutput = JSON.parse(extractJson(resultText));
      } catch {
        // ignore - handled below
      }
    }
 
    if (structuredOutput === undefined) {
      throw new ReviewError('No structured output returned by the agent', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    }
 
    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      logger.error(`Schema validation failed: ${parsed.error.message}`);
      throw new ReviewError('Structured output failed schema validation', ErrorCodes.VALIDATION_FAILED, {
        issues: parsed.error.issues.slice(0, 10),
      });
    }
 
    return parsed.data;
  }
}
 
/** Extract a JSON object from text (handles ```json fences) */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
 
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));
 
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator, ORCHESTRATOR_ALLOWED_TOOLS } from '../src/orchestrator';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types';
import { DEFAULT_RATE_LIMITS } from '../src/utils/rate-limiter';
 
const mockedQuery = vi.mocked(query);
 
const validReport = {
  pullRequest: { owner: 'udacity', repo: 'cd14715-simple-todo-app', number: 1 },
  fileReviews: [],
  summary: {
    totalFiles: 0,
    overallScore: 85,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0,
  },
  recommendations: [
    { priority: 'high', category: 'testing', description: 'Add unit tests', files: ['src/app.js'] },
  ],
  metadata: { analyzedAt: new Date().toISOString(), duration: 0, agentVersions: {} },
};
 
function mockQueryResult(structured_output: unknown) {
  mockedQuery.mockImplementation((() =>
    (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'mcp__github__get_pull_request_files', input: {} },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'code-quality-analyzer' } },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'test-coverage-analyzer' } },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'refactoring-suggester' } },
          ],
        },
      };
      yield { type: 'result', subtype: 'success', result: '', structured_output };
    })()) as any);
}
 
function lastQueryArgs(): any {
  return mockedQuery.mock.calls[mockedQuery.mock.calls.length - 1]?.[0];
}
 
describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });
 
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      const config = orchestrator.getConfig();
      expect(config.rateLimits).toEqual(DEFAULT_RATE_LIMITS);
      expect(config.maxTurns).toBe(50);
      expect(config.maxRetries).toBeGreaterThan(0);
    });
 
    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: { maxConcurrent: 1, maxRequestsPerMinute: 5 },
      });
      const config = orchestrator.getConfig();
      expect(config.rateLimits.maxConcurrent).toBe(1);
      expect(config.rateLimits.maxRequestsPerMinute).toBe(5);
      expect(config.rateLimits.maxTokensPerMinute).toBe(DEFAULT_RATE_LIMITS.maxTokensPerMinute);
    });
  });
 
  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      mockQueryResult(validReport);
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      await orchestrator.reviewPullRequest('udacity', 'cd14715-simple-todo-app', 1);
 
      const args = lastQueryArgs();
      expect(args.prompt).toContain('udacity');
      expect(args.prompt).toContain('cd14715-simple-todo-app');
      expect(args.options.mcpServers).toHaveProperty('github');
      expect(ORCHESTRATOR_ALLOWED_TOOLS).toContain('mcp__github__get_pull_request_files');
    });
 
    it('should spawn all 3 subagents in parallel', async () => {
      mockQueryResult(validReport);
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      await orchestrator.reviewPullRequest('udacity', 'cd14715-simple-todo-app', 1);
 
      const args = lastQueryArgs();
      expect(Object.keys(args.options.agents)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester',
      ]);
      expect(args.options.allowedTools).toContain('Task');
    });
 
    it('should aggregate results into ReviewReport', async () => {
      mockQueryResult(validReport);
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      const report = await orchestrator.reviewPullRequest('udacity', 'cd14715-simple-todo-app', 1);
 
      expect(report.pullRequest.number).toBe(1);
      expect(report.summary.overallScore).toBe(85);
      expect(report.recommendations).toHaveLength(1);
      expect(typeof report.metadata.duration).toBe('number');
    });
 
    it('should validate output with Zod schema', async () => {
      mockQueryResult({ invalid: true });
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      await expect(
        orchestrator.reviewPullRequest('udacity', 'cd14715-simple-todo-app', 1)
      ).rejects.toThrow();
    }, 20000);
 
    it('should reject an invalid PR number', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      await expect(orchestrator.reviewPullRequest('o', 'r', -1)).rejects.toThrow();
      expect(mockedQuery).not.toHaveBeenCalled();
    });
  });
 
  describe('Schemas', () => {
    it('accepts valid report data', () => {
      expect(ReviewReportSchema.safeParse(validReport).success).toBe(true);
    });
 
    it('rejects invalid priority', () => {
      const bad = {
        ...validReport,
        recommendations: [{ ...validReport.recommendations[0], priority: 'urgent' }],
      };
      expect(ReviewReportSchema.safeParse(bad).success).toBe(false);
    });
 
    it('accepts boundary scores 0 and 100', () => {
      for (const score of [0, 100]) {
        const r = { ...validReport, summary: { ...validReport.summary, overallScore: score } };
        expect(ReviewReportSchema.safeParse(r).success).toBe(true);
      }
    });
 
    it('JSON schema includes required top-level fields', () => {
      const text = JSON.stringify(ReviewReportJSONSchema);
      for (const field of ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']) {
        expect(text).toContain(field);
      }
    });
  });
 
  describe('Integration', () => {
    it.skip('should review a real small PR', async () => {
      // Requires real API keys and network access
    });
  });
});

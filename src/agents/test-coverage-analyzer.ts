import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';
 
/**
* Test Coverage Analyzer subagent
* Least privilege: read-only tools + Skill
*/
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage specialist. Use this agent to evaluate test coverage of pull request changes, find untested code paths, and suggest missing test cases.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
};

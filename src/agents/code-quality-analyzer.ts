import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';
 
/**
* Code Quality Analyzer subagent
* Least privilege: read-only tools + Skill
*/
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Expert code quality analyst. Use this agent to analyze pull request code for bugs, security vulnerabilities, readability, error handling, and JavaScript/TypeScript best practices.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
};

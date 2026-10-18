import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';
 
/**
* Refactoring Suggester subagent
* Least privilege: read-only tools + Skill
*/
export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring expert. Use this agent to identify code smells, duplication, complexity, and design improvements in pull request changes.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
};

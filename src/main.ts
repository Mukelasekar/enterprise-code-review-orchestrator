import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
 
dotenv.config();
 
async function main(): Promise<void> {
  const [owner, repo, prStr] = process.argv.slice(2);
 
  // 1. Validate arguments
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev -- <owner> <repo> <prNumber>');
    console.error('Example: npm run dev -- udacity cd14715-simple-todo-app 1');
    process.exit(1);
  }
  const prNumber = Number(prStr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`❌ Invalid PR number "${prStr}". It must be a positive integer.`);
    process.exit(1);
  }
 
  // 2. Validate authentication
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasBedrock =
    !!process.env.AWS_ACCESS_KEY_ID &&
    !!process.env.AWS_SECRET_ACCESS_KEY &&
    !!process.env.AWS_REGION;
 
  if (hasBedrock) {
    console.log('🔐 Using AWS Bedrock authentication');
  } else if (hasAnthropic) {
    console.log('🔐 Using Anthropic API authentication');
  } else {
    console.error('❌ No authentication configured. Set ONE of the following in .env:');
    console.error('   Option 1 (Anthropic API): ANTHROPIC_API_KEY=sk-ant-...');
    console.error('   Option 2 (AWS Bedrock):   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
    process.exit(1);
  }
 
  // 3. Validate model
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('❌ ANTHROPIC_MODEL is not set in .env');
    console.error('   Anthropic example: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929');
    console.error('   Bedrock example:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }
 
  console.log(`🚀 Starting review of ${owner}/${repo} PR #${prNumber} (model: ${process.env.ANTHROPIC_MODEL})`);
 
  try {
    // 4. Run orchestrator
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);
 
    // 5. Generate and save reports
    const generator = new ReportGenerator();
    const reportsDir = path.resolve(process.cwd(), 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
 
    const base = path.join(reportsDir, `${owner}_${repo}_${prNumber}`);
    fs.writeFileSync(`${base}.md`, generator.generateMarkdownReport(report));
    fs.writeFileSync(`${base}.html`, generator.generateHTMLReport(report));
    fs.writeFileSync(`${base}.json`, generator.generateJSONReport(report));
 
    console.log('\n✅ Review complete!');
    console.log(`   Files reviewed:  ${report.summary.totalFiles}`);
    console.log(`   Overall score:   ${report.summary.overallScore}`);
    console.log(`   Critical issues: ${report.summary.criticalIssues}`);
    console.log('\n📄 Reports saved:');
    console.log(`   ${base}.md`);
    console.log(`   ${base}.html`);
    console.log(`   ${base}.json`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Review failed: ${message}`);
    process.exit(1);
  }
}
 
main();

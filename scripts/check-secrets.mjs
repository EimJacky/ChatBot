import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/* global console, process */

const genericSecretPatterns = [
  { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9_-]{16,}/ },
  { name: 'Discord bot token', pattern: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/ },
];

const envSecretPatterns = [
  { name: 'Non-placeholder Discord token', pattern: /^DISCORD_TOKEN=(?!replace-me$).+/m },
  { name: 'Non-placeholder AI API key', pattern: /^AI_API_KEY=(?!replace-me$).+/m },
  { name: 'Non-empty Tavily search key', pattern: /^SEARCH_API_KEY=.+/m },
];

const allowedEnvFiles = new Set(['.env.example']);
const stagedFiles = getGitFiles(['diff', '--cached', '--name-only']);
const trackedFiles = getGitFiles(['ls-files']);
const trackedOrStaged = new Set([...stagedFiles, ...trackedFiles]);
const candidateFiles = new Set([...stagedFiles, ...trackedFiles]);

for (const envFile of ['.env copy']) {
  if (existsSync(envFile)) {
    candidateFiles.add(envFile);
  }
}

const findings = [];

for (const file of candidateFiles) {
  if (file.startsWith('node_modules/') || file.startsWith('dist/')) {
    continue;
  }

  if (file.startsWith('.env') && !allowedEnvFiles.has(file) && trackedOrStaged.has(file)) {
    findings.push({ file, reason: 'env files with real secrets must stay untracked and uncommitted' });
    continue;
  }

  if (file === '.env copy') {
    findings.push({ file, reason: 'remove manual env backups from the project root' });
    continue;
  }

  if (!existsSync(file)) {
    continue;
  }

  const content = readFileSync(file, 'utf8');
  for (const { name, pattern } of genericSecretPatterns) {
    if (pattern.test(content)) {
      findings.push({ file, reason: name });
      break;
    }
  }

  if (findings.some((finding) => finding.file === file) || !file.startsWith('.env')) {
    continue;
  }

  for (const { name, pattern } of envSecretPatterns) {
    if (pattern.test(content)) {
      findings.push({ file, reason: name });
      break;
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed. Remove or rotate secrets before committing:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log('Secret scan passed.');

function getGitFiles(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

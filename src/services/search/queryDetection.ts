import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { ExtendedChatCompletionsClient } from '../ai/AIService.js';

export interface IntentDetectionOptions {
  enabled: boolean;
  client?: ExtendedChatCompletionsClient;
  model?: string;
  timeoutMs?: number;
}

export interface IntentDetectionCache {
  get(key: string): boolean | undefined;
  set(key: string, value: boolean): void;
}

const MIN_QUERY_LENGTH = 6;

// Keep CJK literals as unicode escapes so Windows shell/codepage conversions cannot corrupt them.
const SEARCH_KEYWORDS = [
  '\u4eca\u5929',
  '\u6700\u65b0',
  '\u73b0\u5728',
  '\u76ee\u524d',
  '\u5f53\u524d',
  '\u8fd1\u671f',
  '\u5b9e\u65f6',
  '\u65b0\u95fb',
  '\u5929\u6c14',
  '\u80a1\u7968',
  '\u4ef7\u683c',
  '\u591a\u5c11\u94b1',
  '\u884c\u60c5',
  '\u6c47\u7387',
  '\u8d5b\u4e8b',
  '\u7248\u672c',
  '\u53d1\u5e03',
  '\u653f\u7b56',
  '\u6d3b\u52a8',
  '\u8bc4\u6d4b',
  '\u5bf9\u6bd4',
  '\u54ea\u4e2a\u597d',
  '\u6700\u591a',
  '\u6392\u540d',
  '\u699c\u5355',
  '\u4ed3\u5e93',
  'github',
  'star',
  'stars',
  'repository',
  'repositories',
  'ranking',
  'rank',
  'today',
  'latest',
  'current',
  'recent',
  'news',
  'weather',
  'stock',
  'price',
  'exchange rate',
  'score',
  'version',
  'release',
  'review',
  'compare',
  'best',
];

const NON_SEARCH_PATTERNS = [
  /\u4f60\u662f\u8c01/,
  /\u4f60\u80fd\u505a\u4ec0\u4e48/,
  /\u4ecb\u7ecd\u4e00\u4e0b\u4f60/,
  /\u5199.*\u8bd7/,
  /\u5199.*\u6545\u4e8b/,
  /\u89e3\u91ca\u4e00\u4e0b/,
  /\u4ec0\u4e48\u662f/,
  /\bwho are you\b/i,
  /\bwrite (a|an)\b/i,
  /\bexplain\b/i,
  /\bwhat is\b/i,
];

export const INTENT_FEW_SHOTS = [
  ['\u4eca\u5929\u6709\u4ec0\u4e48 AI \u65b0\u95fb\uff1f', { needsSearch: true }],
  ['What is the latest Node.js LTS version?', { needsSearch: true }],
  ['\u89e3\u91ca\u4e00\u4e0b\u4ec0\u4e48\u662f\u9012\u5f52', { needsSearch: false }],
  ['\u5e2e\u6211\u5199\u4e00\u9996\u5173\u4e8e\u590f\u5929\u7684\u77ed\u8bd7', { needsSearch: false }],
  ['\u5317\u4eac\u660e\u5929\u5929\u6c14\u600e\u4e48\u6837\uff1f', { needsSearch: true }],
  ['Compare iPhone 16 and Galaxy S25 reviews.', { needsSearch: true }],
] as const;

export function normalizeSearchQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function keywordNeedsWebSearch(query: string): boolean {
  const normalized = normalizeSearchQuery(query);
  if (normalized.length < MIN_QUERY_LENGTH) {
    return false;
  }

  const hasSearchKeyword = SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
  if (hasSearchKeyword) {
    return true;
  }

  if (NON_SEARCH_PATTERNS.some((pattern) => pattern.test(query))) {
    return false;
  }

  return false;
}

export async function needsWebSearch(
  query: string,
  options: IntentDetectionOptions = { enabled: false },
  cache?: IntentDetectionCache,
): Promise<boolean> {
  const normalized = normalizeSearchQuery(query);
  if (keywordNeedsWebSearch(query)) {
    return true;
  }

  if (normalized.length < MIN_QUERY_LENGTH || !options.enabled || !options.client) {
    return false;
  }

  const cacheKey = `intent:${normalized}`;
  const cached = cache?.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const result = await classifyWithLLM(query, options);
    cache?.set(cacheKey, result);
    return result;
  } catch {
    return false;
  }
}

async function classifyWithLLM(query: string, options: IntentDetectionOptions): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);

  try {
    const response = (await options.client?.create(
      {
        model: options.model ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: [
              'Decide whether answering the user requires current web search.',
              'Return strict JSON only: {"needsSearch": true} or {"needsSearch": false}.',
              'Examples:',
              ...INTENT_FEW_SHOTS.map(([question, answer]) => `Q: ${question}\nA: ${JSON.stringify(answer)}`),
            ].join('\n'),
          },
          { role: 'user', content: query },
        ],
        temperature: 0,
        max_tokens: 20,
      },
      { signal: controller.signal },
    )) as ChatCompletion | undefined;

    const content = response?.choices[0]?.message?.content ?? '';
    return parseNeedsSearchJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseNeedsSearchJson(content: string): boolean {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return false;
    }

    const parsed = JSON.parse(match[0]) as { needsSearch?: unknown };
    return parsed.needsSearch === true;
  } catch {
    return false;
  }
}

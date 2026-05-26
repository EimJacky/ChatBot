import type { Tokenizer } from '../context/Tokenizer.js';
import type { SearchResult } from './SearchProvider.js';

export interface PromptAugmentorConfig {
  prefix: string;
  suffix: string;
  maxChars: number;
  maxTitleChars: number;
  maxSnippetChars: number;
}

export interface PromptAugmentation {
  promptInjection: string;
  estimatedTokens: number;
  results: SearchResult[];
}

export const DEFAULT_PROMPT_AUGMENTOR_CONFIG: PromptAugmentorConfig = {
  prefix: [
    '[Web Search Results]',
    'The following web results are temporary reference context for this turn. Use them only when relevant. Answer in normal plain language. Do not output tool calls or request another search. Keep the answer concise and cite source URLs only when they directly support factual claims.',
  ].join('\n'),
  suffix: '[/Web Search Results]',
  maxChars: 1_000,
  maxTitleChars: 80,
  maxSnippetChars: 200,
};

const AD_PATTERNS = [
  /sponsored/i,
  /advertisement/i,
  /广告/,
  /推广/,
];
const controlCharactersPattern = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
);

export class PromptAugmentor {
  constructor(
    private readonly tokenizer: Tokenizer,
    private readonly config: PromptAugmentorConfig = DEFAULT_PROMPT_AUGMENTOR_CONFIG,
  ) {}

  augment(systemPrompt: string, promptInjection: string): string {
    return promptInjection ? `${systemPrompt}\n\n${promptInjection}` : systemPrompt;
  }

  formatSearchResults(results: SearchResult[]): PromptAugmentation {
    const sanitized = sanitizeResults(results, this.config);
    const promptInjection = this.fitToBudget(sanitized);

    return {
      promptInjection,
      estimatedTokens: promptInjection ? this.tokenizer.countText(promptInjection) : 0,
      results: sanitized,
    };
  }

  private fitToBudget(results: SearchResult[]): string {
    for (let count = results.length; count >= 1; count -= 1) {
      const text = this.format(results.slice(0, count));
      if (text.length <= this.config.maxChars) {
        return text;
      }
    }

    const [first] = results;
    if (!first) {
      return '';
    }

    const compressed = {
      ...first,
      snippet: truncate(first.snippet, Math.min(80, this.config.maxSnippetChars)),
    };
    const text = this.format([compressed]);
    return text.length > this.config.maxChars ? `${text.slice(0, this.config.maxChars - 3)}...` : text;
  }

  private format(results: SearchResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const entries = results.map((result, index) => {
      return [
        `${index + 1}. **${result.title}**`,
        `   ${result.snippet}`,
        `   Source: ${result.url}`,
      ].join('\n');
    });

    return [this.config.prefix, ...entries, this.config.suffix].join('\n\n');
  }
}

function sanitizeResults(results: SearchResult[], config: PromptAugmentorConfig): SearchResult[] {
  const seenUrls = new Set<string>();

  return results
    .map((result) => ({
      title: cleanText(result.title),
      snippet: cleanText(result.snippet),
      url: result.url.trim(),
    }))
    .filter((result) => {
      if (!result.title || !result.url || result.snippet.length < 20) {
        return false;
      }
      if (!isHttpUrl(result.url) || seenUrls.has(result.url)) {
        return false;
      }
      if (AD_PATTERNS.some((pattern) => pattern.test(result.title) || pattern.test(result.snippet))) {
        return false;
      }
      seenUrls.add(result.url);
      return true;
    })
    .map((result) => ({
      title: truncate(result.title, config.maxTitleChars),
      snippet: truncate(result.snippet, config.maxSnippetChars),
      url: result.url,
    }));
}

function cleanText(text: string): string {
  return text
    .replace(controlCharactersPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

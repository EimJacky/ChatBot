import { describe, expect, it } from 'vitest';
import { PromptAugmentor } from '../src/services/search/PromptAugmentor.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';

describe('PromptAugmentor', () => {
  it('formats and estimates search result prompt injections', () => {
    const augmentor = new PromptAugmentor(new Tokenizer());
    const result = augmentor.formatSearchResults([
      {
        title: 'AI News',
        snippet: 'This is a sufficiently long snippet about a current AI news item.',
        url: 'https://example.com/news',
      },
    ]);

    expect(result.promptInjection).toContain('[Web Search Results]');
    expect(result.promptInjection).toContain('**AI News**');
    expect(result.promptInjection).toContain('Source: https://example.com/news');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('filters unsafe, duplicate, ad, and low-quality results', () => {
    const augmentor = new PromptAugmentor(new Tokenizer());
    const result = augmentor.formatSearchResults([
      { title: 'No URL', snippet: 'This snippet is long enough to pass filtering.', url: '' },
      { title: 'Bad URL', snippet: 'This snippet is long enough to pass filtering.', url: 'javascript:alert(1)' },
      { title: 'Sponsored', snippet: 'This sponsored result should be filtered out.', url: 'https://ad.example.com' },
      { title: 'Short', snippet: 'too short', url: 'https://short.example.com' },
      {
        title: 'Good',
        snippet: 'This is a useful result with enough content for the prompt injection.',
        url: 'https://example.com/good',
      },
      {
        title: 'Good duplicate',
        snippet: 'This is a useful result with enough content for the prompt injection.',
        url: 'https://example.com/good',
      },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe('Good');
  });

  it('enforces the configured hard character limit with ellipsis', () => {
    const augmentor = new PromptAugmentor(new Tokenizer(), {
      prefix: '[Web Search Results]',
      suffix: '[/Web Search Results]',
      maxChars: 160,
      maxTitleChars: 80,
      maxSnippetChars: 200,
    });
    const result = augmentor.formatSearchResults([
      {
        title: 'Long Title',
        snippet: 'x'.repeat(500),
        url: 'https://example.com/long',
      },
    ]);

    expect(result.promptInjection.length).toBeLessThanOrEqual(160);
    expect(result.promptInjection.endsWith('...')).toBe(true);
  });

  it('augments the system prompt only when injection exists', () => {
    const augmentor = new PromptAugmentor(new Tokenizer());
    expect(augmentor.augment('system', '')).toBe('system');
    expect(augmentor.augment('system', 'search')).toBe('system\n\nsearch');
  });
});


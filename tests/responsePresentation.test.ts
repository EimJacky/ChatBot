import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord.js';
import { buildResponsePresentation } from '../src/services/discord/ResponsePresentation.js';

describe('buildResponsePresentation', () => {
  it('adds search, code, and table embeds for rich Discord replies', () => {
    const presentation = buildResponsePresentation(
      [
        'Here is code:',
        '```ts',
        'const answer = 42;',
        '```',
        '| Name | Value |',
        '| --- | --- |',
        '| foo | bar |',
      ].join('\n'),
      {
        searchPerformed: true,
        cacheHit: false,
        estimatedTokens: 10,
        promptInjection: '',
        results: [
          {
            title: 'Example result',
            snippet: 'A useful search result snippet.',
            url: 'https://example.com',
          },
        ],
      },
    );

    expect(presentation.content).toContain('Here is code');
    expect(presentation.embeds).toHaveLength(3);
    const embeds = presentation.embeds as APIEmbed[];
    expect(embeds[0]?.title).toBe('Search Results');
    expect(embeds[1]?.title).toBe('Code (ts)');
    expect(embeds[2]?.title).toBe('Table Preview');
  });

  it('returns plain content when no rich blocks exist', () => {
    expect(buildResponsePresentation('plain answer')).toEqual({ content: 'plain answer' });
  });
});

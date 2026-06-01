import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord.js';
import {
  buildErrorPresentation,
  buildResponsePresentation,
  isPaginationCustomId,
  resolvePaginatedPresentation,
} from '../src/services/discord/ResponsePresentation.js';

describe('buildResponsePresentation', () => {
  it('adds source, code, table, and source button embeds for rich Discord replies', () => {
    const presentation = buildResponsePresentation(
      [
        'Here is code:',
        '```ts',
        'const answer = 42;',
        '```',
        '```json',
        '{"ok":true}',
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
    expect(presentation.embeds?.length).toBeGreaterThanOrEqual(5);
    expect(presentation.components).toHaveLength(1);
    const embeds = presentation.embeds as APIEmbed[];
    expect(embeds[0]?.title).toBe('Search Results');
    expect(embeds[1]?.author?.name).toBe('example.com');
    expect(embeds.some((embed) => embed.title === 'Code 1 (ts)')).toBe(true);
    expect(embeds.some((embed) => embed.title === 'Code 2 (json)')).toBe(true);
    expect(embeds.some((embed) => embed.title === 'Table 1')).toBe(true);
  });

  it('returns plain content when no rich blocks exist', () => {
    expect(buildResponsePresentation('plain answer')).toEqual({ content: 'plain answer' });
  });

  it('paginates long plain content into continuation embeds', () => {
    const presentation = buildResponsePresentation('Long '.repeat(900));
    const components = presentation.components as Array<{ components: Array<{ custom_id?: string; disabled?: boolean }> }> | undefined;
    const nextButton = components?.at(-1)?.components[2];

    expect(presentation.content).toContain('Long');
    expect(nextButton?.custom_id).toBeTruthy();
    expect(nextButton?.disabled).toBe(false);
    expect(isPaginationCustomId(nextButton?.custom_id ?? '')).toBe(true);
    const nextPage = resolvePaginatedPresentation(nextButton?.custom_id ?? '');
    expect(nextPage?.embeds?.[0]).toMatchObject({ title: 'Answer Page 2/3' });
  });

  it('builds error cards', () => {
    expect(buildErrorPresentation('nope', 'NOPE')).toMatchObject({
      content: 'nope',
      embeds: [expect.objectContaining({ title: 'Request Failed' })],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { extractAnnotations } from '../src/services/ai/AIService.js';

describe('extractAnnotations', () => {
  it('parses MiMo url_citation annotations', () => {
    expect(
      extractAnnotations({
        annotations: [
          {
            url_citation: {
              title: 'MiMo Source',
              url: 'https://example.com/mimo',
            },
          },
        ],
      }),
    ).toEqual([{ title: 'MiMo Source', url: 'https://example.com/mimo' }]);
  });

  it('parses flat annotations', () => {
    expect(
      extractAnnotations({
        annotations: [
          {
            title: 'Flat Source',
            url: 'https://example.com/flat',
          },
        ],
      }),
    ).toEqual([{ title: 'Flat Source', url: 'https://example.com/flat' }]);
  });

  it('returns empty arrays for empty or non-array annotations', () => {
    expect(extractAnnotations({ annotations: [] })).toEqual([]);
    expect(extractAnnotations({ annotations: 'not-array' })).toEqual([]);
    expect(extractAnnotations(undefined)).toEqual([]);
  });

  it('filters annotations without a URL', () => {
    expect(
      extractAnnotations({
        annotations: [{ title: 'No URL' }, { url_citation: { title: 'Still no URL' } }],
      }),
    ).toEqual([]);
  });
});

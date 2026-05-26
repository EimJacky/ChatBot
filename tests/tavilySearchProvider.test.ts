import { afterEach, describe, expect, it, vi } from 'vitest';
import { TavilySearchProvider } from '../src/services/search/TavilySearchProvider.js';

describe('TavilySearchProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts Tavily search requests and normalizes results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            query: 'ai news',
            results: [{ title: 'AI News', content: 'Fresh AI update content.', url: 'https://example.com' }],
          }),
        ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new TavilySearchProvider({ apiKey: 'key' });
    const result = await provider.search('ai news', 2);

    expect(result).toEqual({
      provider: 'tavily',
      query: 'ai news',
      results: [{ title: 'AI News', snippet: 'Fresh AI update content.', url: 'https://example.com' }],
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      api_key: 'key',
      query: 'ai news',
      max_results: 2,
      include_answer: false,
      include_raw_content: false,
    });
  });

  it('throws on non-200 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('bad key'),
      }),
    );

    await expect(new TavilySearchProvider({ apiKey: 'key' }).search('ai news', 2)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('wraps network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(new TavilySearchProvider({ apiKey: 'key' }).search('ai news', 2)).rejects.toMatchObject({
      code: 'SEARCH_REQUEST_FAILED',
    });
  });
});


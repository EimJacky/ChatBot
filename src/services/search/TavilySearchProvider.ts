import type { SearchProvider, SearchResponse, SearchResult } from './SearchProvider.js';
import { createHttpError, isHttpError } from '../../utils/errors.js';

interface TavilySearchProviderOptions {
  apiKey: string;
  timeoutMs?: number;
}

interface TavilyResult {
  title?: unknown;
  content?: unknown;
  url?: unknown;
}

interface TavilyResponse {
  results?: TavilyResult[];
  query?: string;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  private readonly timeoutMs: number;

  constructor(private readonly options: TavilySearchProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async search(query: string, limit: number): Promise<SearchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          query,
          max_results: limit,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw createHttpError(`Tavily search failed: ${response.status} ${text}`, response.status);
      }

      const payload = JSON.parse(text) as TavilyResponse;
      return {
        query: typeof payload.query === 'string' ? payload.query : query,
        provider: this.name,
        results: normalizeResults(payload.results),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw createHttpError('Tavily search timed out.', 408, 'SEARCH_TIMEOUT', error);
      }

      if (isHttpError(error)) {
        throw error;
      }

      throw createHttpError(
        error instanceof Error ? error.message : 'Tavily search failed.',
        0,
        'SEARCH_REQUEST_FAILED',
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeResults(results: TavilyResult[] | undefined): SearchResult[] {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map<SearchResult | undefined>((result) => {
      const title = typeof result.title === 'string' ? result.title : '';
      const snippet = typeof result.content === 'string' ? result.content : '';
      const url = typeof result.url === 'string' ? result.url : '';
      return title || snippet || url ? { title, snippet, url } : undefined;
    })
    .filter((result): result is SearchResult => Boolean(result));
}


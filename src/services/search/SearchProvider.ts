export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  provider: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResponse>;
}


import type { APIEmbed, InteractionEditReplyOptions, MessageEditOptions } from 'discord.js';
import type { SearchServiceResult } from '../search/SearchService.js';
import { fitDiscordMessage } from '../../utils/text.js';

export type ResponsePresentation = Pick<InteractionEditReplyOptions & MessageEditOptions, 'content' | 'embeds'>;

const EMBED_COLOR = 0x3b82f6;

export function buildResponsePresentation(
  content: string,
  searchResult?: SearchServiceResult,
): ResponsePresentation {
  const embeds = [
    ...(searchResult?.results.length ? [buildSearchEmbed(searchResult)] : []),
    ...buildContentEmbeds(content),
  ].slice(0, 3);

  return {
    content: fitDiscordMessage(content),
    ...(embeds.length > 0 ? { embeds } : {}),
  };
}

function buildSearchEmbed(searchResult: SearchServiceResult): APIEmbed {
  return {
    title: searchResult.cacheHit ? 'Search Results (cached)' : 'Search Results',
    color: EMBED_COLOR,
    fields: searchResult.results.slice(0, 3).map((result, index) => ({
      name: `${index + 1}. ${truncate(result.title || result.url, 96)}`,
      value: [
        result.snippet ? truncate(result.snippet, 220) : undefined,
        result.url ? `[Open source](${result.url})` : undefined,
      ].filter(Boolean).join('\n'),
    })),
  };
}

function buildContentEmbeds(content: string): APIEmbed[] {
  const embeds: APIEmbed[] = [];
  const code = extractFirstCodeBlock(content);
  if (code) {
    embeds.push({
      title: code.language ? `Code (${code.language})` : 'Code',
      color: 0x10b981,
      description: formatCodeDescription(code.language, code.body),
    });
  }

  const table = extractFirstMarkdownTable(content);
  if (table) {
    embeds.push({
      title: 'Table Preview',
      color: 0xf59e0b,
      description: `\`\`\`\n${truncate(table, 900)}\n\`\`\``,
    });
  }

  return embeds;
}

function extractFirstCodeBlock(content: string): { language: string; body: string } | undefined {
  const match = /```(\w+)?\s*\n([\s\S]*?)```/.exec(content);
  if (!match?.[2]?.trim()) {
    return undefined;
  }
  return {
    language: match[1] ?? '',
    body: match[2].trim(),
  };
}

function extractFirstMarkdownTable(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? '';
    const separator = lines[index + 1]?.trim() ?? '';
    if (!header.includes('|') || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
      continue;
    }

    const tableLines = [header, separator];
    for (let row = index + 2; row < lines.length; row += 1) {
      const line = lines[row]?.trim() ?? '';
      if (!line.includes('|')) {
        break;
      }
      tableLines.push(line);
    }
    return tableLines.join('\n');
  }
  return undefined;
}

function formatCodeDescription(language: string, body: string): string {
  const fenceLanguage = language.replace(/[`\s]/g, '');
  return `\`\`\`${fenceLanguage}\n${truncate(body, 900)}\n\`\`\``;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

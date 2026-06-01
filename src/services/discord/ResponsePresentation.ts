import { randomUUID } from 'node:crypto';
import { ButtonStyle } from 'discord.js';
import type { APIEmbed, InteractionEditReplyOptions, MessageEditOptions } from 'discord.js';
import type { SearchServiceResult } from '../search/SearchService.js';
import type { TopUsageUser, UsageSummary } from '../storage/interfaces.js';
import { fitDiscordMessage } from '../../utils/text.js';

export type ResponsePresentation = Omit<
  Pick<InteractionEditReplyOptions & MessageEditOptions, 'content' | 'embeds' | 'components'>,
  'content'
> & { content: string };

const COLORS = {
  answer: 0x5865f2,
  search: 0x3b82f6,
  code: 0x10b981,
  table: 0xf59e0b,
  warning: 0xef4444,
  stats: 0x8b5cf6,
  usage: 0x06b6d4,
} as const;

const MAX_EMBEDS = 10;
const MAX_CODE_EMBEDS = 4;
const MAX_TABLE_EMBEDS = 3;
const MAX_SOURCE_EMBEDS = 4;
const CONTENT_PAGE_LENGTH = 1_850;
const PAGINATION_TTL_MS = 15 * 60 * 1_000;
const PAGINATION_PREFIX = 'echomate:page';

interface PaginationSession {
  pages: ResponsePresentation[];
  expiresAt: number;
}

const paginationSessions = new Map<string, PaginationSession>();

export function buildResponsePresentation(
  content: string,
  searchResult?: SearchServiceResult,
): ResponsePresentation {
  const answerStyle = detectAnswerStyle(content, searchResult);
  const embeds = [
    ...buildSearchEmbeds(searchResult),
    ...buildContentEmbeds(content),
  ].slice(0, MAX_EMBEDS);
  const components = buildSourceButtons(searchResult);
  const contentPages = splitIntoChunks(content, CONTENT_PAGE_LENGTH);

  if (contentPages.length > 1) {
    return createPaginatedPresentation(contentPages, embeds, components, answerStyle);
  }

  return {
    content: fitDiscordMessage(content),
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}

export function isPaginationCustomId(customId: string): boolean {
  return customId.startsWith(`${PAGINATION_PREFIX}:`);
}

export function resolvePaginatedPresentation(customId: string): ResponsePresentation | undefined {
  cleanupExpiredPaginationSessions();
  const [, , sessionId, pageText] = customId.split(':');
  const pageIndex = Number(pageText);
  if (!sessionId || !Number.isInteger(pageIndex)) {
    return undefined;
  }

  const session = paginationSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    paginationSessions.delete(sessionId);
    return undefined;
  }

  return session.pages[pageIndex];
}

export interface StatsDashboardInput {
  conversationKey: string;
  messages: number;
  estimatedTokens: number;
  activeChannels: number;
  contextWindowTokens: number;
}

export function buildStatsDashboard(input: StatsDashboardInput): ResponsePresentation {
  return {
    content: `Stats for ${input.conversationKey}`,
    embeds: [
      {
        title: 'Conversation Stats',
        color: COLORS.stats,
        description: `\`${truncate(input.conversationKey, 180)}\``,
        fields: [
          metricField('Messages', input.messages),
          metricField('Estimated tokens', input.estimatedTokens),
          metricField('Active conversations', input.activeChannels),
          metricField('Context window', input.contextWindowTokens),
        ],
        footer: { text: 'Current conversation only, unless active conversations is shown.' },
      },
    ],
  };
}

export interface UsageDashboardInput {
  userId: string;
  windows: Array<{ days: number; summary: UsageSummary }>;
  owner?: {
    global30d: UsageSummary;
    topUsers: TopUsageUser[];
    detailEnabled: boolean;
  };
}

export function buildUsageDashboard(input: UsageDashboardInput): ResponsePresentation {
  const fields = input.windows.map(({ days, summary }) => ({
    name: `${days}d`,
    value: [
      `Replies: **${summary.requests}**`,
      `Tokens: **${formatNumber(summary.inputTokens + summary.outputTokens)}**`,
      `Searches: **${summary.searchRequests}**`,
      `Avg: **${summary.averageElapsedMs}ms**`,
    ].join('\n'),
    inline: true,
  }));

  const embeds: APIEmbed[] = [
    {
      title: 'Usage Dashboard',
      color: COLORS.usage,
      description: `Summary for <@${input.userId}>`,
      fields,
    },
  ];

  if (input.owner) {
    embeds.push({
      title: 'Owner 30d Overview',
      color: COLORS.stats,
      description: input.owner.detailEnabled
        ? 'Owner detail mode is enabled.'
        : 'Owner detail mode is disabled; showing aggregate and Top N only.',
      fields: [
        metricField('Global replies', input.owner.global30d.requests),
        metricField('Global tokens', input.owner.global30d.inputTokens + input.owner.global30d.outputTokens),
        metricField('Global searches', input.owner.global30d.searchRequests),
        {
          name: 'Top users',
          value: input.owner.topUsers.length > 0
            ? input.owner.topUsers
              .map((user, index) => `${index + 1}. <@${user.userId}>: ${user.requests} replies, ${formatNumber(user.inputTokens + user.outputTokens)} tokens`)
              .join('\n')
            : 'None',
        },
      ],
    });
  }

  return {
    content: `Usage for <@${input.userId}>`,
    embeds,
  };
}

export interface ModelsDashboardInput {
  provider: string;
  model: string;
  fallback: string;
  temperature: number;
  maxTokens: number;
  contextWindowTokens: number;
  streaming: boolean;
  webSearchStatus: string;
  searchMode: string;
  searchLimit: number;
  supportsWebSearch: boolean;
  supportsThinking: boolean;
  supportsAnnotations: boolean;
}

export function buildModelsDashboard(input: ModelsDashboardInput): ResponsePresentation {
  return {
    content: 'Model configuration',
    embeds: [
      {
        title: 'Model Configuration',
        color: COLORS.stats,
        fields: [
          { name: 'Provider', value: input.provider, inline: true },
          { name: 'Model', value: input.model, inline: true },
          { name: 'Fallback', value: input.fallback, inline: true },
          metricField('Max tokens', input.maxTokens),
          metricField('Context window', input.contextWindowTokens),
          { name: 'Temperature', value: `**${input.temperature}**`, inline: true },
        ],
      },
      {
        title: 'Capabilities',
        color: COLORS.search,
        fields: [
          { name: 'Streaming', value: formatBoolean(input.streaming), inline: true },
          { name: 'Web search status', value: input.webSearchStatus, inline: true },
          { name: 'Search mode', value: input.searchMode, inline: true },
          metricField('Search limit', input.searchLimit),
          { name: 'Supports web search', value: formatBoolean(input.supportsWebSearch), inline: true },
          { name: 'Supports thinking', value: formatBoolean(input.supportsThinking), inline: true },
          { name: 'Supports annotations', value: formatBoolean(input.supportsAnnotations), inline: true },
        ],
      },
    ],
  };
}

export interface DebugDashboardInput {
  memoryRssMb: string;
  heapUsedMb: string;
  activeChannels: number;
  contextMessages: number;
  contextTokens: number;
  userLimiterKeys: number;
  channelLimiterKeys: number;
  mentionLimiterKeys: number;
  provider: string;
  diagnosticsCount: number;
  webSearchStatus: string;
  lastAiReason: string;
  appSearchMode: string;
  searchDiagnostics: unknown;
  storageHealth: unknown;
  metrics: unknown;
}

export function buildDebugDashboard(input: DebugDashboardInput): ResponsePresentation {
  return {
    content: 'Runtime debug dashboard',
    embeds: [
      {
        title: 'Runtime',
        color: COLORS.warning,
        fields: [
          { name: 'RSS MB', value: `**${input.memoryRssMb}**`, inline: true },
          { name: 'Heap MB', value: `**${input.heapUsedMb}**`, inline: true },
          metricField('Active conversations', input.activeChannels),
          metricField('Context messages', input.contextMessages),
          metricField('Context tokens', input.contextTokens),
        ],
      },
      {
        title: 'Limiters and AI',
        color: COLORS.stats,
        fields: [
          metricField('User limiter keys', input.userLimiterKeys),
          metricField('Channel limiter keys', input.channelLimiterKeys),
          metricField('Mention limiter keys', input.mentionLimiterKeys),
          { name: 'Provider', value: input.provider, inline: true },
          metricField('AI diagnostics', input.diagnosticsCount),
          { name: 'Web search', value: input.webSearchStatus, inline: true },
          { name: 'Last AI reason', value: truncate(input.lastAiReason, 220), inline: false },
          { name: 'App search mode', value: input.appSearchMode, inline: true },
        ],
      },
      {
        title: 'Storage and Metrics',
        color: COLORS.usage,
        fields: [
          { name: 'Search diagnostics', value: codeJson(input.searchDiagnostics), inline: false },
          { name: 'Storage health', value: codeJson(input.storageHealth), inline: false },
          { name: 'Metrics', value: codeJson(input.metrics), inline: false },
        ],
      },
    ],
  };
}

export function buildErrorPresentation(message: string, code = 'ERROR'): ResponsePresentation {
  return {
    content: message,
    embeds: [
      {
        title: 'Request Failed',
        color: COLORS.warning,
        description: truncate(message, 1_000),
        fields: [{ name: 'Code', value: code, inline: true }],
      },
    ],
  };
}

function buildContentEmbeds(content: string): APIEmbed[] {
  const embeds: APIEmbed[] = [];
  const codeBlocks = extractCodeBlocks(content).slice(0, MAX_CODE_EMBEDS);
  for (const [index, code] of codeBlocks.entries()) {
    embeds.push({
      title: code.language ? `Code ${index + 1} (${code.language})` : `Code ${index + 1}`,
      color: COLORS.code,
      description: formatCodeDescription(code.language, code.body),
      footer: { text: `${code.body.split(/\r?\n/).length} lines` },
    });
  }

  const tables = extractMarkdownTables(content).slice(0, MAX_TABLE_EMBEDS);
  for (const [index, table] of tables.entries()) {
    embeds.push(buildTableEmbed(table, index + 1));
  }

  return embeds;
}

function buildSearchEmbeds(searchResult: SearchServiceResult | undefined): APIEmbed[] {
  if (!searchResult?.results.length) {
    return [];
  }

  const groups = groupSearchResultsByDomain(searchResult.results);
  const overview: APIEmbed = {
    title: searchResult.cacheHit ? 'Search Results (cached)' : 'Search Results',
    color: COLORS.search,
    description: `Grouped across ${groups.length} source${groups.length === 1 ? '' : 's'}.`,
    fields: groups.slice(0, 6).map((group) => ({
      name: group.domain,
      value: group.results
        .slice(0, 2)
        .map((entry) => `${confidenceLabel(entry.confidence)} - [${truncate(entry.result.title || entry.domain, 80)}](${entry.result.url})`)
        .join('\n'),
      inline: false,
    })),
  };

  const sourceEmbeds = groups
    .flatMap((group) => group.results)
    .slice(0, MAX_SOURCE_EMBEDS)
    .map((entry, index): APIEmbed => ({
      title: truncate(entry.result.title || entry.domain, 240),
      url: entry.result.url,
      color: COLORS.search,
      author: {
        name: entry.domain,
        icon_url: faviconUrl(entry.domain),
      },
      thumbnail: { url: faviconUrl(entry.domain) },
      description: truncate(entry.result.snippet || 'No snippet returned.', 420),
      fields: [
        { name: 'Confidence', value: confidenceLabel(entry.confidence), inline: true },
        { name: 'Source', value: entry.domain, inline: true },
        { name: 'Rank', value: `#${index + 1}`, inline: true },
      ],
    }));

  return [overview, ...sourceEmbeds];
}

function buildSourceButtons(searchResult: SearchServiceResult | undefined): NonNullable<ResponsePresentation['components']> {
  if (!searchResult?.results.length) {
    return [];
  }

  const buttons = searchResult.results
    .slice(0, 5)
    .map((result, index) => ({
      type: 2,
      style: ButtonStyle.Link,
      label: `Source ${index + 1}`,
      url: result.url,
    }));

  return buttons.length > 0 ? [{ type: 1, components: buttons }] : [];
}

function createPaginatedPresentation(
  contentPages: string[],
  firstPageEmbeds: APIEmbed[],
  sourceComponents: NonNullable<ResponsePresentation['components']>,
  style: AnswerStyle,
): ResponsePresentation {
  cleanupExpiredPaginationSessions();
  const sessionId = randomUUID().replace(/-/g, '').slice(0, 16);
  const pages = contentPages.map((content, index): ResponsePresentation => {
    const embeds = index === 0
      ? firstPageEmbeds
      : [{
        title: `Answer Page ${index + 1}/${contentPages.length}`,
        color: style.color,
        description: 'Continuation page',
        footer: { text: 'Use the buttons below to move between pages.' },
      }];
    const components = [
      ...sourceComponents,
      buildPaginationControls(sessionId, index, contentPages.length),
    ];
    return {
      content: fitDiscordMessage(content),
      ...(embeds.length > 0 ? { embeds: embeds.slice(0, MAX_EMBEDS) } : {}),
      components,
    };
  });
  paginationSessions.set(sessionId, {
    pages,
    expiresAt: Date.now() + PAGINATION_TTL_MS,
  });
  return pages[0] ?? { content: '' };
}

function buildPaginationControls(sessionId: string, currentPage: number, totalPages: number) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: ButtonStyle.Secondary,
        label: 'Previous',
        custom_id: `${PAGINATION_PREFIX}:${sessionId}:${Math.max(0, currentPage - 1)}`,
        disabled: currentPage === 0,
      },
      {
        type: 2,
        style: ButtonStyle.Secondary,
        label: `Page ${currentPage + 1}/${totalPages}`,
        custom_id: `${PAGINATION_PREFIX}:${sessionId}:${currentPage}`,
        disabled: true,
      },
      {
        type: 2,
        style: ButtonStyle.Secondary,
        label: 'Next',
        custom_id: `${PAGINATION_PREFIX}:${sessionId}:${Math.min(totalPages - 1, currentPage + 1)}`,
        disabled: currentPage >= totalPages - 1,
      },
    ],
  };
}

function cleanupExpiredPaginationSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of paginationSessions.entries()) {
    if (session.expiresAt <= now) {
      paginationSessions.delete(sessionId);
    }
  }
}

function extractCodeBlocks(content: string): Array<{ language: string; body: string }> {
  const blocks: Array<{ language: string; body: string }> = [];
  const matcher = /```([A-Za-z0-9_+#.-]+)?[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content)) !== null) {
    if (match[2]?.trim()) {
      blocks.push({
        language: match[1] ?? '',
        body: match[2].trim(),
      });
    }
  }
  return blocks;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function extractMarkdownTables(content: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? '';
    const separator = lines[index + 1]?.trim() ?? '';
    if (!header.includes('|') || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
      continue;
    }

    const headers = splitTableRow(header);
    const rows: string[][] = [];
    for (let row = index + 2; row < lines.length; row += 1) {
      const line = lines[row]?.trim() ?? '';
      if (!line.includes('|')) {
        break;
      }
      rows.push(splitTableRow(line));
      index = row;
    }

    if (headers.length > 0 && rows.length > 0) {
      tables.push({ headers, rows });
    }
  }
  return tables;
}

function buildTableEmbed(table: ParsedTable, tableNumber: number): APIEmbed {
  const fields = table.rows.slice(0, 8).map((row, rowIndex) => {
    const name = truncate(row[0] || `Row ${rowIndex + 1}`, 96);
    const values = table.headers
      .slice(row[0] ? 1 : 0, 5)
      .map((header, columnIndex) => {
        const cellIndex = row[0] ? columnIndex + 1 : columnIndex;
        return `**${truncate(header, 48)}:** ${truncate(row[cellIndex] ?? '-', 180)}`;
      })
      .join('\n');
    return {
      name,
      value: values || '-',
      inline: false,
    };
  });

  return {
    title: `Table ${tableNumber}`,
    color: COLORS.table,
    fields,
    footer: {
      text: `${table.rows.length} rows - ${table.headers.length} columns${table.rows.length > fields.length ? ' - truncated' : ''}`,
    },
  };
}

function splitTableRow(row: string): string[] {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function formatCodeDescription(language: string, body: string): string {
  const fenceLanguage = language.replace(/[`\s]/g, '');
  return `\`\`\`${fenceLanguage}\n${truncatePreserveLines(body, 1_600)}\n\`\`\``;
}

interface SearchGroupEntry {
  domain: string;
  result: SearchServiceResult['results'][number];
  confidence: number;
}

function groupSearchResultsByDomain(results: SearchServiceResult['results']): Array<{ domain: string; results: SearchGroupEntry[] }> {
  const groups = new Map<string, SearchGroupEntry[]>();
  for (const [index, result] of results.entries()) {
    const domain = extractDomain(result.url);
    const confidence = scoreSourceConfidence(domain, index);
    const entries = groups.get(domain) ?? [];
    entries.push({ domain, result, confidence });
    groups.set(domain, entries);
  }

  return [...groups.entries()].map(([domain, groupedResults]) => ({ domain, results: groupedResults }));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown source';
  }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function confidenceLabel(confidence: number): string {
  const label = confidence >= 85 ? 'High' : confidence >= 70 ? 'Medium' : 'Low';
  return `${label} (${confidence}%)`;
}

function scoreSourceConfidence(domain: string, index: number): number {
  let score = 82 - index * 6;
  if (/\.(gov|edu)$/i.test(domain)) {
    score += 10;
  }
  if (/\.org$/i.test(domain)) {
    score += 4;
  }
  if (/^(docs|developer|support|help|learn)\./i.test(domain)) {
    score += 7;
  }
  if (/(github\.com|microsoft\.com|mozilla\.org|wikipedia\.org|openai\.com)$/i.test(domain)) {
    score += 5;
  }
  return Math.min(96, Math.max(52, score));
}

interface AnswerStyle {
  color: number;
}

function detectAnswerStyle(content: string, searchResult: SearchServiceResult | undefined): AnswerStyle {
  if (/\b(warning|caution|error|failed|danger|risk)\b/i.test(content)) {
    return { color: COLORS.warning };
  }
  if (/```/.test(content)) {
    return { color: COLORS.code };
  }
  if (/\|.*\|/.test(content)) {
    return { color: COLORS.table };
  }
  if (searchResult?.results.length) {
    return { color: COLORS.search };
  }
  return { color: COLORS.answer };
}

function metricField(name: string, value: number): { name: string; value: string; inline: true } {
  return {
    name,
    value: `**${formatNumber(value)}**`,
    inline: true,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBoolean(value: boolean): string {
  return value ? 'Enabled' : 'Disabled';
}

function codeJson(value: unknown): string {
  return `\`\`\`json\n${truncatePreserveLines(JSON.stringify(value, null, 2), 900)}\n\`\`\``;
}

function splitIntoChunks(value: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxLength) {
    const splitAt = Math.max(
      remaining.lastIndexOf('\n\n', maxLength),
      remaining.lastIndexOf('\n', maxLength),
      remaining.lastIndexOf(' ', maxLength),
    );
    const index = splitAt > maxLength * 0.5 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function truncatePreserveLines(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

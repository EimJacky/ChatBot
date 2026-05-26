import { describe, expect, it, vi } from 'vitest';
import { keywordNeedsWebSearch, needsWebSearch, parseNeedsSearchJson } from '../src/services/search/queryDetection.js';

describe('queryDetection', () => {
  it('detects Chinese and English search intent by keywords', () => {
    expect(keywordNeedsWebSearch('\u4eca\u5929\u6709\u4ec0\u4e48 AI \u65b0\u95fb\uff1f')).toBe(true);
    expect(keywordNeedsWebSearch('\u4eca\u5929\u6bd4\u7279\u5e01\u591a\u5c11\u94b1')).toBe(true);
    expect(keywordNeedsWebSearch('GitHub\u4e0a\u76ee\u524dstar\u6700\u591a\u7684\u4ed3\u5e93\u5730\u5740\u662f\u4ec0\u4e48')).toBe(true);
    expect(keywordNeedsWebSearch('What is the latest Node.js LTS version?')).toBe(true);
    expect(keywordNeedsWebSearch('Compare iPhone 16 and Galaxy S25 reviews.')).toBe(true);
  });

  it('does not search short questions or obvious static prompts', () => {
    expect(keywordNeedsWebSearch('\u5929\u6c14')).toBe(false);
    expect(keywordNeedsWebSearch('\u89e3\u91ca\u4e00\u4e0b\u4ec0\u4e48\u662f\u9012\u5f52')).toBe(false);
    expect(keywordNeedsWebSearch('\u5e2e\u6211\u5199\u4e00\u9996\u5173\u4e8e\u590f\u5929\u7684\u77ed\u8bd7')).toBe(false);
  });

  it('uses LLM fallback with strict JSON when enabled', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"needsSearch": true}' } }],
    });

    await expect(
      needsWebSearch('Tell me whether this niche package still exists', {
        enabled: true,
        client: { create } as never,
      }),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns false when LLM fallback fails or emits false', async () => {
    await expect(
      needsWebSearch('Tell me whether this niche package still exists', {
        enabled: true,
        client: { create: vi.fn().mockRejectedValue(new Error('boom')) } as never,
      }),
    ).resolves.toBe(false);

    expect(parseNeedsSearchJson('{"needsSearch": false}')).toBe(false);
  });

  it('parses JSON embedded in surrounding LLM text and never throws on invalid content', () => {
    expect(parseNeedsSearchJson('Sure: {"needsSearch": true}\nDone.')).toBe(true);
    expect(parseNeedsSearchJson('not json at all')).toBe(false);
    expect(parseNeedsSearchJson('')).toBe(false);
  });
});

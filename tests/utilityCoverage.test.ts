import Bottleneck from 'bottleneck';
import { describe, expect, it, vi } from 'vitest';
import { StreamingMessageHandler } from '../src/services/discord/StreamingMessageHandler.js';
import { MemoryContextStore, MemoryRateLimitStore, MemoryUsageStore } from '../src/services/storage/MemoryStores.js';
import { AppError, createHttpError, isHttpError, toAppError, userFacingError } from '../src/utils/errors.js';
import { cleanDiscordText, compactPromptForLog, fitDiscordMessage, stripBotMention } from '../src/utils/text.js';
import { createLogger } from '../src/utils/logger.js';
import { createTraceId, getTraceContext, runWithTrace } from '../src/utils/trace.js';

describe('utility coverage', () => {
  it('maps operational errors to user-facing text', () => {
    expect(toAppError(new AppError('limited', 'RATE_LIMITED'))).toBeInstanceOf(AppError);
    expect(toAppError(new Error('plain'), 'PLAIN').code).toBe('PLAIN');
    expect(toAppError('string-error').message).toBe('string-error');

    expect(userFacingError(new AppError('limited', 'RATE_LIMITED'))).toBe('limited');
    expect(userFacingError(new AppError('blocked', 'PROMPT_BLOCKED'))).toBe('blocked');
    expect(userFacingError(new AppError('too long', 'INPUT_TOO_LONG'))).toBe('too long');
    expect(userFacingError(new AppError('auth', 'AI_AUTH_ERROR'))).toMatch(/authentication/);
    expect(userFacingError(new AppError('model', 'AI_MODEL_ERROR'))).toMatch(/model/);
    expect(userFacingError(new AppError('timeout', 'AI_TIMEOUT'))).toMatch(/timed out/);
    expect(userFacingError(new Error('unknown'))).toMatch(/Something went wrong/);

    const http = createHttpError('bad', 500, 'E_BAD', new Error('cause'));
    expect(isHttpError(http)).toBe(true);
    expect(isHttpError(new Error('no status'))).toBe(false);
  });

  it('cleans and fits Discord text', () => {
    expect(cleanDiscordText('<tool_call>secret</tool_call> hi @everyone @here \u0000')).toBe('hi @\u200beveryone @\u200bhere');
    expect(cleanDiscordText('<function=x>secret</function><parameter=y>p</parameter> ok')).toBe('ok');
    expect(fitDiscordMessage('', 20)).toBe('No response.');
    expect(fitDiscordMessage('a'.repeat(80), 40)).toMatch(/\[response truncated\]/);
    expect(compactPromptForLog('a\n  b')).toBe('a b');
    expect(compactPromptForLog('x'.repeat(130))).toHaveLength(123);
    expect(stripBotMention('<@123> <@!123> hello', '123')).toBe('hello');
  });

  it('flushes streaming messages through timers and defaults', async () => {
    const handler = new StreamingMessageHandler(new Bottleneck({ maxConcurrent: 1 }), 5);
    const reply = { editReply: vi.fn().mockResolvedValue(undefined) };

    await handler.start(reply as never);
    await handler.append(reply, 'a');
    await handler.append(reply, 'b');
    await new Promise((resolve) => setTimeout(resolve, 15));
    await handler.edit(reply, '');

    expect(reply.editReply).toHaveBeenCalledWith('Thinking...');

    const immediate = new StreamingMessageHandler(new Bottleneck({ maxConcurrent: 1 }), 0);
    await immediate.append(reply, 'now');
    expect(reply.editReply).toHaveBeenCalledWith('now');
  });

  it('exercises memory store batch and cleanup paths', () => {
    const context = new MemoryContextStore();
    context.batchSetConversations([
      { conversationKey: 'channel:a', messages: [{ role: 'user', content: 'a', timestamp: 1 }], expiresAt: Date.now() + 10_000 },
      { conversationKey: 'thread:b', messages: [{ role: 'assistant', content: 'b', timestamp: 2 }], expiresAt: Date.now() - 1 },
    ]);

    expect(context.batchGetConversations(['channel:a', 'missing']).get('channel:a')?.[0]?.content).toBe('a');
    expect(context.getConversation('thread:b')).toEqual([]);
    expect(context.listKeysByPrefix('channel:')).toEqual(['channel:a']);
    expect(context.countConversations()).toBe(1);
    expect(context.cleanupExpired()).toBe(0);
    context.deleteConversation('channel:a');
    expect(context.countConversations()).toBe(0);

    const rate = new MemoryRateLimitStore();
    rate.setBucket('scope', 'live', { count: 1, resetAt: Date.now() + 1_000, expiresAt: Date.now() + 1_000 });
    rate.setBucket('scope', 'old', { count: 1, resetAt: Date.now() - 1, expiresAt: Date.now() - 1 });
    expect(rate.getBucket('scope', 'live')?.count).toBe(1);
    expect(rate.getBucket('scope', 'old')).toBeUndefined();
    expect(rate.countBuckets('scope')).toBe(1);
    expect(rate.deleteExpired()).toBe(0);

    const usage = new MemoryUsageStore();
    usage.recordUsage({
      id: 'u1',
      userId: 'alice',
      conversationKey: 'channel:a',
      channelId: 'a',
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
      searchPerformed: true,
      searchCacheHit: true,
      elapsedMs: 10,
      createdAt: Date.now(),
    });
    usage.recordUsage({
      id: 'u2',
      userId: 'bob',
      conversationKey: 'channel:b',
      channelId: 'b',
      model: 'm',
      inputTokens: 4,
      outputTokens: 5,
      searchPerformed: false,
      searchCacheHit: false,
      elapsedMs: 20,
      createdAt: Date.now() - 10_000,
    });
    expect(usage.summarizeUser('alice', 0)).toMatchObject({ requests: 1, searchRequests: 1 });
    expect(usage.summarizeGlobal(0)).toMatchObject({ requests: 2, inputTokens: 5 });
    expect(usage.topUsers(0, 1)).toEqual([{ userId: 'alice', requests: 1, inputTokens: 1, outputTokens: 2 }]);
    expect(usage.cleanupOlderThan(Date.now() - 1_000)).toBe(1);
  });

  it('propagates trace context and creates logger transports', () => {
    const traceId = createTraceId();
    runWithTrace({ traceId, userId: 'u1' }, () => {
      expect(getTraceContext()).toMatchObject({ traceId, userId: 'u1' });
      runWithTrace({ channelId: 'c1' }, () => {
        expect(getTraceContext()).toMatchObject({ traceId, userId: 'u1', channelId: 'c1' });
      });
    });

    const logger = createLogger({ nodeEnv: 'production', logLevel: 'silent', logDestination: '' });
    logger.info('silent logger smoke test');
    expect(logger.level).toBe('silent');
  });
});

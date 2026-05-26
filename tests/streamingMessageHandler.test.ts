import Bottleneck from 'bottleneck';
import { describe, expect, it, vi } from 'vitest';
import { StreamingMessageHandler } from '../src/services/discord/StreamingMessageHandler.js';

describe('StreamingMessageHandler', () => {
  it('edits with the final message', async () => {
    const handler = new StreamingMessageHandler(new Bottleneck({ maxConcurrent: 1 }), 1);
    const reply = {
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handler.append(reply, 'hello');
    await handler.finish(reply, 'hello world');

    expect(reply.editReply).toHaveBeenLastCalledWith('hello world');
  });

  it('keeps concurrent request buffers isolated when handlers are per request', async () => {
    const firstHandler = new StreamingMessageHandler(new Bottleneck({ maxConcurrent: 1 }), 1);
    const secondHandler = new StreamingMessageHandler(new Bottleneck({ maxConcurrent: 1 }), 1);
    const firstReply = { editReply: vi.fn().mockResolvedValue(undefined) };
    const secondReply = { editReply: vi.fn().mockResolvedValue(undefined) };

    await Promise.all([
      firstHandler.append(firstReply, 'alpha '),
      secondHandler.append(secondReply, 'bravo '),
    ]);
    await Promise.all([
      firstHandler.finish(firstReply, 'alpha done'),
      secondHandler.finish(secondReply, 'bravo done'),
    ]);

    expect(firstReply.editReply).toHaveBeenLastCalledWith('alpha done');
    expect(secondReply.editReply).toHaveBeenLastCalledWith('bravo done');
    expect(firstReply.editReply).not.toHaveBeenCalledWith('bravo done');
    expect(secondReply.editReply).not.toHaveBeenCalledWith('alpha done');
  });
});

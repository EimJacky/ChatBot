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
});


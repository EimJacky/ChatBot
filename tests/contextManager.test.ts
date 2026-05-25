import { describe, expect, it } from 'vitest';
import { ContextManager } from '../src/services/context/ContextManager.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';

describe('ContextManager', () => {
  it('isolates channels and resets one channel', () => {
    const manager = new ContextManager(new Tokenizer(), {
      maxContextMessages: 10,
      contextWindowTokens: 500,
      contextTtlHours: 1,
      reserveOutputTokens: 100,
    });

    manager.add('a', { role: 'user', content: 'hello', timestamp: 1 });
    manager.add('b', { role: 'user', content: 'world', timestamp: 1 });
    manager.reset('a');

    expect(manager.get('a')).toHaveLength(0);
    expect(manager.get('b')).toHaveLength(1);
  });

  it('trims by token budget before message count', () => {
    const manager = new ContextManager(new Tokenizer(), {
      maxContextMessages: 50,
      contextWindowTokens: 80,
      contextTtlHours: 1,
      reserveOutputTokens: 20,
    });

    for (let i = 0; i < 20; i += 1) {
      manager.add('channel', {
        role: 'user',
        content: `message ${i} `.repeat(20),
        timestamp: i,
      });
    }

    const stats = manager.getStats('channel');
    expect(stats.messages).toBeLessThan(20);
    expect(stats.estimatedTokens).toBeLessThanOrEqual(80);
  });

  it('compresses to the most recent messages', () => {
    const manager = new ContextManager(new Tokenizer(), {
      maxContextMessages: 10,
      contextWindowTokens: 500,
      contextTtlHours: 1,
      reserveOutputTokens: 100,
    });

    const compressed = manager.compress(
      [1, 2, 3, 4].map((value) => ({
        role: 'user' as const,
        content: String(value),
        timestamp: value,
      })),
      2,
    );

    expect(compressed).toMatchInlineSnapshot(`
      [
        {
          "content": "3",
          "role": "user",
          "timestamp": 3,
        },
        {
          "content": "4",
          "role": "user",
          "timestamp": 4,
        },
      ]
    `);
  });
});


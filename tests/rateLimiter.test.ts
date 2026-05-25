import { describe, expect, it, vi } from 'vitest';
import { DailyCounterLimiter, FixedWindowRateLimiter } from '../src/services/rateLimit/RateLimiter.js';

describe('rate limiters', () => {
  it('limits fixed-window usage and recovers after the window', () => {
    vi.useFakeTimers();
    const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 1000 });

    limiter.check('key');
    limiter.check('key');
    expect(() => limiter.check('key')).toThrow(/Rate limit/);

    vi.advanceTimersByTime(1001);
    expect(() => limiter.check('key')).not.toThrow();
    vi.useRealTimers();
  });

  it('limits daily mentions', () => {
    const limiter = new DailyCounterLimiter(1);

    limiter.check('guild');
    expect(() => limiter.check('guild')).toThrow(/Daily mention/);
  });
});


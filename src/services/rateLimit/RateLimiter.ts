import { LRUCache } from 'lru-cache';
import { AppError } from '../../utils/errors.js';
import type { RateLimitStore } from '../storage/interfaces.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterRule {
  max: number;
  windowMs: number;
  maxKeys?: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets: LRUCache<string, Bucket>;

  constructor(
    private readonly rule: RateLimiterRule,
    private readonly store?: RateLimitStore,
    private readonly scope = 'fixed',
  ) {
    this.buckets = new LRUCache<string, Bucket>({
      max: rule.maxKeys ?? 10_000,
      ttl: rule.windowMs * 2,
      ttlAutopurge: true,
    });
  }

  check(key: string, label = 'requests'): void {
    const now = Date.now();
    const bucket = this.store?.getBucket(this.scope, key, now) ?? this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.setBucket(key, { count: 1, resetAt: now + this.rule.windowMs });
      return;
    }

    if (bucket.count >= this.rule.max) {
      const retrySeconds = Math.ceil((bucket.resetAt - now) / 1_000);
      throw new AppError(
        `Rate limit reached for ${label}. Try again in ${retrySeconds}s.`,
        'RATE_LIMITED',
      );
    }

    this.setBucket(key, { count: bucket.count + 1, resetAt: bucket.resetAt });
  }

  getStats() {
    this.buckets.purgeStale();
    return {
      keys: this.store?.countBuckets(this.scope) ?? this.buckets.size,
      max: this.rule.max,
      windowMs: this.rule.windowMs,
    };
  }

  private setBucket(key: string, bucket: Bucket): void {
    if (this.store) {
      this.store.setBucket(this.scope, key, {
        ...bucket,
        expiresAt: bucket.resetAt + this.rule.windowMs,
      });
      return;
    }
    this.buckets.set(key, bucket);
  }
}

export class DailyCounterLimiter {
  private readonly windowMs = 24 * 60 * 60 * 1_000;
  private readonly buckets: LRUCache<string, Bucket>;

  constructor(
    private readonly max: number,
    private readonly store?: RateLimitStore,
    private readonly scope = 'daily',
  ) {
    this.buckets = new LRUCache<string, Bucket>({
      max: 50_000,
      ttl: this.windowMs,
      ttlAutopurge: true,
    });
  }

  check(key: string): void {
    const now = Date.now();
    const bucket = this.store?.getBucket(this.scope, key, now) ?? this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.setBucket(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    if (bucket.count >= this.max) {
      throw new AppError('Daily mention limit reached. Please use /chat instead.', 'RATE_LIMITED');
    }

    this.setBucket(key, { count: bucket.count + 1, resetAt: bucket.resetAt });
  }

  getStats() {
    this.buckets.purgeStale();
    return {
      keys: this.store?.countBuckets(this.scope) ?? this.buckets.size,
      max: this.max,
      windowMs: this.windowMs,
    };
  }

  getCount(key: string): number {
    return this.store?.getBucket(this.scope, key)?.count ?? this.buckets.get(key)?.count ?? 0;
  }

  private setBucket(key: string, bucket: Bucket): void {
    if (this.store) {
      this.store.setBucket(this.scope, key, {
        ...bucket,
        expiresAt: bucket.resetAt,
      });
      return;
    }
    this.buckets.set(key, bucket);
  }
}

export class BotRateLimiters {
  constructor(
    public readonly user: FixedWindowRateLimiter,
    public readonly channel: FixedWindowRateLimiter,
    public readonly mentionDaily: DailyCounterLimiter,
  ) {}

  checkChat(userId: string, channelId: string): void {
    this.user.check(userId, 'user');
    this.channel.check(channelId, 'channel');
  }

  getStats() {
    return {
      user: this.user.getStats(),
      channel: this.channel.getStats(),
      mentionDaily: this.mentionDaily.getStats(),
    };
  }
}

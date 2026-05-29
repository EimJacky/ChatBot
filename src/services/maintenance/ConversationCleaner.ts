import type { Env } from '../../config/env.js';
import type { AppLogger } from '../../utils/logger.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { RateLimitStore, StorageMonitor, UsageStore } from '../storage/interfaces.js';

export class ConversationCleaner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly contextManager: ContextManager,
    private readonly rateLimitStore: RateLimitStore,
    private readonly usageStore: UsageStore,
    private readonly storageMonitor: StorageMonitor,
  ) {}

  start(): void {
    if (!this.env.conversationCleanupEnabled || this.timer) {
      return;
    }
    const initialDelay = Math.floor(Math.random() * Math.min(this.env.conversationCleanupIntervalMs, 60_000));
    this.schedule(initialDelay);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn('conversation cleaner skipped because previous run is still active');
      return;
    }
    this.running = true;
    const started = Date.now();
    try {
      const now = Date.now();
      const contextDeleted = this.contextManager.cleanupExpired(now);
      const rateLimitDeleted = this.rateLimitStore.deleteExpired(now);
      const usageDeleted = this.usageStore.cleanupOlderThan(
        now - this.env.usageRetentionDays * 24 * 60 * 60 * 1_000,
      );
      const storageHealth = this.storageMonitor.check();
      this.logger.info(
        {
          contextDeleted,
          rateLimitDeleted,
          usageDeleted,
          storageHealth,
          elapsedMs: Date.now() - started,
        },
        'conversation cleaner finished',
      );
    } catch (error) {
      this.logger.error({ err: error, elapsedMs: Date.now() - started }, 'conversation cleaner failed');
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.schedule(this.env.conversationCleanupIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}

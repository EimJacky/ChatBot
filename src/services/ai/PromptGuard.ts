import type { AppLogger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';
import type { PromptGuardRules } from '../../config/promptGuardRules.js';

export class PromptGuard {
  private readonly denyPatterns: RegExp[];

  constructor(
    private readonly rules: PromptGuardRules,
    private readonly logger: AppLogger,
  ) {
    this.denyPatterns = rules.denyPatterns.map((pattern) => {
      if (pattern.startsWith('(?i)')) {
        return new RegExp(pattern.slice(4), 'i');
      }

      return new RegExp(pattern);
    });
  }

  assertAllowed(input: string, context: { traceId: string; userId: string; channelId: string }): void {
    const matched = this.denyPatterns.find((pattern) => pattern.test(input));

    if (!matched) {
      return;
    }

    this.logger.warn(
      {
        traceId: context.traceId,
        userId: context.userId,
        channelId: context.channelId,
        pattern: matched.source,
      },
      'prompt guard blocked input',
    );

    throw new AppError(this.rules.denyMessage, 'PROMPT_BLOCKED');
  }

  wrapUserContent(input: string): string {
    return `<user_message>\n${input}\n</user_message>`;
  }
}

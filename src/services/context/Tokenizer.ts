import { countTokens } from 'gpt-tokenizer';
import type { ChatMessage } from '../../types/chat.js';

export class Tokenizer {
  countText(text: string): number {
    return countTokens(text);
  }

  countMessages(messages: Pick<ChatMessage, 'role' | 'content'>[]): number {
    return messages.reduce((total, message) => {
      return total + this.countText(`${message.role}: ${message.content}`) + 4;
    }, 0);
  }
}


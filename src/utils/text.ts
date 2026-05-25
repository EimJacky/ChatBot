const DISCORD_MESSAGE_LIMIT = 2000;

export function cleanDiscordText(input: string): string {
  return input
    .replace(new RegExp(String.fromCharCode(0), 'g'), '')
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g, '@\u200bhere')
    .trim();
}

export function fitDiscordMessage(input: string, limit = DISCORD_MESSAGE_LIMIT): string {
  const cleaned = cleanDiscordText(input);

  if (cleaned.length <= limit) {
    return cleaned || 'No response.';
  }

  return `${cleaned.slice(0, limit - 24)}\n\n[response truncated]`;
}

export function compactPromptForLog(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

export function stripBotMention(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .trim();
}

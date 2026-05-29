import { Events } from 'discord.js';
import type { Client, Message } from 'discord.js';
import type { Container } from '../config/container.js';
import { cleanDiscordText, stripBotMention } from '../utils/text.js';
import { createTraceId, runWithTrace } from '../utils/trace.js';

export function registerMessageCreateEvent(client: Client, container: Container) {
  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessage(message, container);
  });
}

async function handleMessage(message: Message, container: Container) {
  if (!container.env.enableMentionTrigger || message.author.bot || !message.client.user) {
    return;
  }

  const botId = message.client.user.id;
  if (!message.mentions.users.has(botId)) {
    return;
  }

  await runWithTrace({
    traceId: createTraceId(),
    userId: message.author.id,
    guildId: message.guildId ?? undefined,
    channelId: message.channelId,
  }, async () => {
  container.logger.info(
    {
      userId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      hasContent: message.content.length > 0,
    },
    'received bot mention',
  );

  const prompt = await buildMentionPrompt(message, botId, stripBotMention(message.content, botId), container);
  if (!prompt) {
    await message.reply('Use `/chat` with a prompt, or mention me with a question.');
    return;
  }

  await container.chatUseCase.handleMention(message, prompt);
  });
}

export async function buildMentionPrompt(
  message: Message,
  botId: string,
  prompt: string,
  container: Pick<Container, 'env' | 'logger'>,
): Promise<string> {
  const trimmed = prompt.trim();
  if (!container.env.messageReferenceEnabled || !('fetchReference' in message) || !message.reference) {
    return trimmed;
  }

  try {
    const referenced = await message.fetchReference();
    if (referenced.author.id !== botId && !referenced.author.bot) {
      return trimmed;
    }
    const referencedContent = cleanDiscordText(referenced.content).slice(0, 1_200);
    if (!referencedContent) {
      return trimmed;
    }
    return [
      'Referenced bot message:',
      referencedContent,
      '',
      'User follow-up:',
      trimmed,
    ].join('\n');
  } catch (error) {
    container.logger.warn({ err: error, messageId: message.id }, 'failed to fetch referenced message');
    return trimmed;
  }
}

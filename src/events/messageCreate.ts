import { Events } from 'discord.js';
import type { Client, Message } from 'discord.js';
import type { Container } from '../config/container.js';
import { stripBotMention } from '../utils/text.js';

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

  container.logger.info(
    {
      userId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      hasContent: message.content.length > 0,
    },
    'received bot mention',
  );

  const prompt = stripBotMention(message.content, botId);
  if (!prompt) {
    await message.reply('Use `/chat` with a prompt, or mention me with a question.');
    return;
  }

  await container.chatUseCase.handleMention(message, prompt);
}

import { SlashCommandBuilder } from 'discord.js';

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Ask the AI assistant a question.')
    .addStringOption((option) =>
      option.setName('prompt').setDescription('What you want to ask.').setRequired(true),
    ),
  new SlashCommandBuilder().setName('reset').setDescription('Reset context for this channel.'),
  new SlashCommandBuilder().setName('stats').setDescription('Show context stats for this channel.'),
  new SlashCommandBuilder().setName('usage').setDescription('Show your usage summary.'),
  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Set or clear your reply style preference.')
    .addStringOption((option) =>
      option
        .setName('style')
        .setDescription('Preferred reply style, or clear to reset.')
        .setRequired(true)
        .addChoices(
          { name: 'concise', value: 'concise' },
          { name: 'detailed', value: 'detailed' },
          { name: 'friendly', value: 'friendly' },
          { name: 'technical', value: 'technical' },
          { name: 'clear', value: 'clear' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('lang')
    .setDescription('Set or clear your reply language preference.')
    .addStringOption((option) =>
      option
        .setName('language')
        .setDescription('Preferred reply language, or clear to reset.')
        .setRequired(true)
        .addChoices(
          { name: 'English', value: 'English' },
          { name: '简体中文', value: '简体中文' },
          { name: '日本語', value: '日本語' },
          { name: '한국어', value: '한국어' },
          { name: 'clear', value: 'clear' },
        ),
    ),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('models').setDescription('Show current AI model configuration.'),
  new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Owner-only runtime diagnostics without secrets.'),
].map((command) => command.toJSON());

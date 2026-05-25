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
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('models').setDescription('Show current AI model configuration.'),
  new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Owner-only runtime diagnostics without secrets.'),
].map((command) => command.toJSON());


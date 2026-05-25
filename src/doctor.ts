import { loadEnv } from './config/env.js';
import { configureGlobalProxy } from './utils/proxy.js';

interface DiscordUser {
  id: string;
  username: string;
  bot?: boolean;
}

interface DiscordApplication {
  id: string;
  name: string;
}

const env = loadEnv();
const proxyUrl = configureGlobalProxy();

if (proxyUrl) {
  console.log(`Using proxy: ${proxyUrl}`);
}

async function discordGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      authorization: `Bot ${env.discordToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

try {
  const [botUser, application] = await Promise.all([
    discordGet<DiscordUser>('/users/@me'),
    discordGet<DiscordApplication>('/oauth2/applications/@me'),
  ]);

  console.log('Discord diagnostics');
  console.log(`Bot user: ${botUser.username} (${botUser.id})`);
  console.log(`Application: ${application.name} (${application.id})`);
  console.log(`Configured DISCORD_CLIENT_ID: ${env.discordClientId}`);
  console.log(`Client ID matches token application: ${application.id === env.discordClientId}`);
  console.log(`Configured DISCORD_GUILD_ID: ${env.discordGuildId || '<global commands>'}`);
  console.log(`AI_BASE_URL: ${env.aiBaseUrl}`);
  console.log(`AI_MODEL: ${env.aiModel}`);

  if (application.id !== env.discordClientId) {
    console.log('');
    console.log('Mismatch found: DISCORD_CLIENT_ID does not belong to the current bot token.');
    console.log('Fix .env so DISCORD_CLIENT_ID equals the Application ID for this Bot Token,');
    console.log('then run npm run register again and restart npm run dev.');
  }
} catch (error) {
  console.error('Discord diagnostics failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}


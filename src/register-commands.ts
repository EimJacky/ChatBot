import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './commands/definitions.js';
import { loadEnv } from './config/env.js';
import { configureGlobalProxy } from './utils/proxy.js';

const env = loadEnv();
const proxyUrl = configureGlobalProxy();
if (proxyUrl) {
  console.log(`Using proxy for Discord API requests: ${proxyUrl}`);
}

const rest = new REST({ version: '10' }).setToken(env.discordToken);

try {
  if (env.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), {
      body: commandDefinitions,
    });
    console.log(`Registered ${commandDefinitions.length} guild commands.`);
  } else {
    await rest.put(Routes.applicationCommands(env.discordClientId), {
      body: commandDefinitions,
    });
    console.log(`Registered ${commandDefinitions.length} global commands.`);
  }
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN';
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Failed to register Discord commands. Code: ${code}`);
  console.error(message);

  if (code.includes('TIMEOUT') || message.toLowerCase().includes('timeout')) {
    console.error(
      [
        '',
        'This is a network timeout while connecting to discord.com:443.',
        'Check that Discord is reachable from this machine, or run with a proxy:',
        '  $env:HTTPS_PROXY="http://127.0.0.1:7890"',
        '  npm run register',
        '',
        'If your proxy uses a different port, replace 7890 with that port.',
      ].join('\n'),
    );
  }

  process.exitCode = 1;
}

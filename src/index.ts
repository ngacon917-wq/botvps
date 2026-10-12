import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initDatabase, pool } from './db/client.js';
import { startAgentServer } from './agent/server.js';
import { BackgroundMonitor } from './core/health/monitor.js';
import { createDiscordClient } from './bot/client.js';

async function bootstrap() {
    if (!config.discord.token || config.discord.token === 'your_discord_bot_token_here') {
        throw new Error('Set DISCORD_TOKEN in .env before starting the bot. Use npm run start:agent for agent-only mode.');
    }
    if (!/^\d{17,20}$/.test(config.discord.ownerId)) {
        throw new Error('Set OWNER_DISCORD_ID to your Discord user ID in .env.');
    }
    await initDatabase();
    const server = process.env.EMBEDDED_AGENT === 'false' ? undefined : await startAgentServer();
    const discordClient = createDiscordClient();
    let stopping = false;
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        BackgroundMonitor.stop();
        await discordClient.destroy();
        if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
        await pool.end();
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    try {
        await discordClient.login(config.discord.token);
        BackgroundMonitor.start(60000);
    } catch (err) {
        await shutdown();
        throw err;
    }
}

bootstrap().catch((err) => {
    logger.error(`Bootstrap fatal error: ${err.message}`);
    process.exit(1);
});

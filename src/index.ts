import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initDatabase } from './db/client.js';
import { startAgentServer } from './agent/server.js';
import { BackgroundMonitor } from './core/health/monitor.js';
import { createDiscordClient } from './bot/client.js';

async function bootstrap() {
    logger.info('==============================================');
    logger.info('   DISCORD LXC VPS MANAGER PLATFORM V2        ');
    logger.info('==============================================');

    // 1. Initialize Database
    try {
        await initDatabase();
    } catch (err: any) {
        logger.error(`Database connection/initialization error: ${err.message}`);
        logger.warn('Please ensure PostgreSQL is installed and credentials are valid in .env');
    }

    // 2. Start Node Agent API Server (Local Node)
    try {
        startAgentServer(config.agent.port);
    } catch (err: any) {
        logger.error(`Failed to start local Node Agent server: ${err.message}`);
    }

    // 3. Start Health & Crash Monitor
    BackgroundMonitor.start(60000);

    // 4. Start Discord Bot Client
    if (!config.discord.token) {
        logger.warn('DISCORD_TOKEN is not provided in environment variables or .env file!');
        logger.warn('The Agent server and database are active. Please configure DISCORD_TOKEN to connect the bot.');
        return;
    }

    const discordClient = createDiscordClient();
    try {
        await discordClient.login(config.discord.token);
    } catch (err: any) {
        logger.error(`Discord login failed: ${err.message}`);
    }

    // Graceful Shutdown
    const handleShutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Shutting down VPSBot gracefully...`);
        BackgroundMonitor.stop();
        discordClient.destroy();
        process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
    logger.error(`Bootstrap fatal error: ${err.message}`, { stack: err.stack });
    process.exit(1);
});

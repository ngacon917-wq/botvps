import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { handleMessage } from './handlers/commandHandler.js';
import { handleInteraction } from './handlers/interactionHandler.js';

export function createDiscordClient(): Client {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
    });

    client.once('ready', (c) => {
        logger.info(`Discord Bot logged in as ${c.user.tag} (ID: ${c.user.id})`);
        logger.info(`Prefix configured: "${config.discord.prefix}"`);
        logger.info(`Master Owner Discord ID: "${config.discord.ownerId || 'NOT SET'}"`);
    });

    client.on('messageCreate', async (message) => {
        try {
            await handleMessage(message);
        } catch (err: any) {
            logger.error(`Error in messageCreate handler: ${err.message}`);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            await handleInteraction(interaction);
        } catch (err: any) {
            logger.error(`Error in interactionCreate handler: ${err.message}`);
        }
    });

    return client;
}

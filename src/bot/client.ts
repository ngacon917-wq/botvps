import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { registerSlashCommands } from './commands/slashCommands.js';
import { handleSlashCommand } from './handlers/slashCommandHandler.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { handleMessage } from './handlers/commandHandler.js';
import { handleInteraction } from './handlers/interactionHandler.js';

export function createDiscordClient(): Client {
    const client = new Client({
        intents: config.discord.enablePrefixCommands
            ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
            : [GatewayIntentBits.Guilds],
        partials: config.discord.enablePrefixCommands ? [Partials.Channel, Partials.Message] : [],
    });

    client.once(Events.ClientReady, async (c) => {
        logger.info(`Discord Bot logged in as ${c.user.tag} (ID: ${c.user.id})`);
        try {
            await registerSlashCommands(c);
        } catch (err: any) {
            logger.error(`Slash command registration failed: ${err.message}. Check DISCORD_GUILD_ID and invite the bot with the applications.commands scope.`);
        }
        logger.info(`Master Owner Discord ID: "${config.discord.ownerId || 'NOT SET'}"`);
    });

    client.on('messageCreate', async (message) => {
        try {
            if (config.discord.enablePrefixCommands) await handleMessage(message);
        } catch (err: any) {
            logger.error(`Error in messageCreate handler: ${err.message}`);
            await message.reply('❌ Không thể xử lý lệnh. Vui lòng kiểm tra kết nối database và nhật ký bot.').catch(() => {});
        }
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) await handleSlashCommand(interaction);
            else await handleInteraction(interaction);
        } catch (err: any) {
            logger.error(`Error in interactionCreate handler: ${err.message}`);
            if (interaction.isRepliable()) {
                const content = '❌ Không thể hoàn thành thao tác. Vui lòng kiểm tra nhật ký bot và thử lại.';
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content, ephemeral: true }).catch(() => {});
                } else {
                    await interaction.reply({ content, ephemeral: true }).catch(() => {});
                }
            }
        }
    });

    return client;
}

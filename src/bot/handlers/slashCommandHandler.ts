import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { getSlashArgs } from '../commands/slashCommands.js';
import { CommandMessage, CommandReply } from '../commands/types.js';
import { isOwner } from '../../config/index.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { logger } from '../../utils/logger.js';

// Keep progress messages editable through the interaction webhook, including ephemeral replies.
export function createInteractionMessage(interaction: ChatInputCommandInteraction): CommandMessage {
    let responded = false;
    const payload = (value: CommandReply) => typeof value === 'string' ? { content: value } : value;
    return {
        author: interaction.user,
        client: interaction.client,
        async reply(value) {
            if (!responded) {
                responded = true;
                await interaction.editReply(payload(value));
                return { edit: (next) => interaction.editReply(payload(next)) };
            }
            const body = payload(value);
            const reply = await interaction.followUp({ ...body, content: body.content ?? undefined, flags: MessageFlags.Ephemeral });
            return { edit: (next) => interaction.webhook.editMessage(reply.id, payload(next)) };
        },
    };
}

export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Acknowledge before any database or agent I/O.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const command = commandMap.get(interaction.commandName);
        if (!command) {
            await interaction.editReply('❌ Lệnh không còn tồn tại. Vui lòng khởi động lại bot để cập nhật danh sách lệnh.');
            return;
        }
        const callerIsOwner = isOwner(interaction.user.id);
        if (command.ownerOnly && !callerIsOwner) {
            await interaction.editReply('❌ Chỉ Master Owner có quyền dùng lệnh này. Dùng /manage để quản lý VPS của bạn.');
            return;
        }
        // Help stays available for diagnosing an unavailable database.
        if (command.name !== 'help') {
            const user = await UserRepository.getOrCreate(interaction.user.id, interaction.user.username);
            if (user.is_banned) {
                await interaction.editReply('⛔ Tài khoản của bạn đã bị khóa quyền sử dụng VPS.');
                return;
            }
        }
        logger.info(`Executing slash command /${command.name} by ${interaction.user.id}`);
        await command.execute({ message: createInteractionMessage(interaction), args: getSlashArgs(interaction), isOwner: callerIsOwner });
    } catch (err: any) {
        logger.error(`Slash command /${interaction.commandName} failed: ${err.message}`);
        await interaction.editReply({ content: '❌ Không thể hoàn thành lệnh. Vui lòng kiểm tra database, agent và nhật ký bot.', embeds: [], components: [] });
    }
}

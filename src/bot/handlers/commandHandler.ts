import { Message } from 'discord.js';
import { config, isOwner } from '../../config/index.js';
import { commandMap } from '../commands/index.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { logger } from '../../utils/logger.js';

export async function handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;

    const prefix = config.discord.prefix;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const command = commandMap.get(commandName);
    if (!command) return;

    // Check user registration and ban status
    const user = await UserRepository.getOrCreate(message.author.id, message.author.username);
    if (user.is_banned) {
        await message.reply('⛔ Tài khoản của bạn đã bị khóa quyền sử dụng VPS trên hệ thống.');
        return;
    }

    const callerIsOwner = isOwner(message.author.id);

    // Strict Permission Enforcement:
    // Only the single Owner can run commands with ownerOnly = true.
    // Non-owners can only run `manage` and `help`.
    if (command.ownerOnly && !callerIsOwner) {
        await message.reply(
            '❌ **Bạn không có quyền sử dụng lệnh này!**\nChỉ Master Owner mới có quyền tạo VPS và thực hiện các lệnh quản trị hệ thống. Người dùng thông thường chỉ có thể sử dụng lệnh `/manage` để quản lý VPS của chính mình.'
        );
        return;
    }

    try {
        logger.info(`Executing command "${commandName}" by ${message.author.tag} (${message.author.id})`);
        await command.execute({
            message: {
                author: message.author, client: message.client,
                reply: (value) => message.reply(typeof value === 'string' ? value : { ...value, content: value.content ?? undefined }),
            },
            args,
            isOwner: callerIsOwner,
        });
    } catch (err: any) {
        logger.error(`Error executing command "${commandName}": ${err.message}`, { stack: err.stack });
        await message.reply(`❌ Đã xảy ra lỗi khi thực thi lệnh: ${err.message}`).catch(() => {});
    }
}

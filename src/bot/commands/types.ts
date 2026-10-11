import { Message } from 'discord.js';

export interface CommandContext {
    message: Message;
    args: string[];
    isOwner: boolean;
}

export interface Command {
    name: string;
    aliases?: string[];
    description: string;
    usage?: string;
    ownerOnly: boolean;
    execute: (ctx: CommandContext) => Promise<void>;
}

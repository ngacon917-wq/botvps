import { Client, MessageCreateOptions, User } from 'discord.js';

export type CommandReply = string | (Pick<MessageCreateOptions, 'embeds' | 'components'> & { content?: string | null });
export interface CommandMessage {
    author: User;
    client: Client;
    reply: (payload: CommandReply) => Promise<{ edit: (payload: CommandReply) => Promise<unknown> }>;
}

export interface CommandContext {
    message: CommandMessage;
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

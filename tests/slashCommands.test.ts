import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCommandOptionType, GatewayIntentBits, MessageFlags } from 'discord.js';
import { allCommands, commandMap } from '../src/bot/commands/index.js';
import { buildSlashCommands, getSlashArgs, registerSlashCommands } from '../src/bot/commands/slashCommands.js';
import { createInteractionMessage, handleSlashCommand } from '../src/bot/handlers/slashCommandHandler.js';
import { createDiscordClient } from '../src/bot/client.js';
import { config } from '../src/config/index.js';
import { UserRepository } from '../src/db/repositories/userRepository.js';

const original = { ...config.discord };
afterEach(() => { vi.restoreAllMocks(); Object.assign(config.discord, original); });
function interaction(name: string, values: Record<string, string | number> = {}): any {
    return {
        commandName: name, user: { id: 'owner', username: 'Owner' }, client: {},
        options: {
            getString: (key: string) => values[key] ?? null,
            getInteger: (key: string) => values[key] ?? null,
            getUser: (key: string) => values[key] ? { id: values[key] } : null,
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue({ id: 'original' }),
        followUp: vi.fn().mockResolvedValue({ id: 'followup' }),
        webhook: { editMessage: vi.fn().mockResolvedValue({}) },
    };
}
describe('slash command registration', () => {
    it('builds a valid slash definition for every command with required options first', () => {
        const definitions = buildSlashCommands();
        expect(definitions.map((command) => command.name)).toEqual(allCommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
        expect(new Set(definitions.map((command) => command.name)).size).toBe(definitions.length);
        for (const command of definitions) {
            let optionalSeen = false;
            for (const option of command.options ?? []) {
                if (!option.required) optionalSeen = true;
                if (option.required) expect(optionalSeen).toBe(false);
            }
        }
        const create = definitions.find((command) => command.name === 'create')!;
        expect(create.options?.map((option) => option.type)).toEqual([
            ApplicationCommandOptionType.Integer, ApplicationCommandOptionType.Integer,
            ApplicationCommandOptionType.Integer, ApplicationCommandOptionType.User,
        ]);
    });
    it('registers in the configured server, or globally when no server is specified', async () => {
        const set = vi.fn().mockResolvedValue(undefined);
        const client = { application: { commands: { set } } } as any;
        config.discord.guildId = 'test-server';
        await registerSlashCommands(client);
        expect(set).toHaveBeenLastCalledWith(expect.any(Array), 'test-server');
        config.discord.guildId = '';
        await registerSlashCommands(client);
        expect(set).toHaveBeenLastCalledWith(expect.any(Array));
    });
    it('does not request Message Content intent by default', async () => {
        config.discord.enablePrefixCommands = false;
        const client = createDiscordClient();
        expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
        expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
        await client.destroy();
    });
});
describe('slash execution', () => {
    it('converts typed options without splitting names containing spaces', () => {
        expect(getSlashArgs(interaction('create', { ram: 512, cpu: 1, disk: 5, user: '123' }))).toEqual(['512', '1', '5', '123']);
        expect(getSlashArgs(interaction('nodeadd', { id: 'worker', name: 'Singapore Node', host: 'host', port: 4000, token: 'test' })))
            .toEqual(['worker', 'Singapore Node', 'host', '4000', 'test']);
        expect(getSlashArgs(interaction('manage'))).toEqual([]);
        expect(getSlashArgs(interaction('diagnose', { id: 'vps-1' }))).toEqual(['vps-1']);
        expect(getSlashArgs(interaction('exec', { id: 'vps-1', command: 'df', args: '-h /' }))).toEqual(['vps-1', 'df', '-h', '/']);
    });
    it('acknowledges before database work and forwards create to the existing OS selection flow', async () => {
        config.discord.ownerId = 'owner';
        const request = interaction('create', { ram: 512, cpu: 1, disk: 5, user: '123' });
        vi.spyOn(UserRepository, 'getOrCreate').mockImplementation(async () => {
            expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
            return { is_banned: false } as any;
        });
        const execute = vi.spyOn(commandMap.get('create')!, 'execute').mockResolvedValue(undefined);
        await handleSlashCommand(request);
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ args: ['512', '1', '5', '123'], isOwner: true }));
    });
    it('opens the real create OS menu from typed slash options', async () => {
        config.discord.ownerId = 'owner';
        vi.spyOn(UserRepository, 'getOrCreate').mockResolvedValue({ is_banned: false } as any);
        const request = interaction('create', { ram: 512, cpu: 1, disk: 5, user: '123' });
        request.client = { users: { fetch: vi.fn().mockResolvedValue({ id: '123', username: 'User', tag: 'User' }) } };
        await handleSlashCommand(request);
        const response = request.editReply.mock.calls[0][0];
        expect(response.embeds).toHaveLength(1);
        const menu = response.components[0].toJSON();
        expect(menu.components[0].custom_id).toMatch(/^create:os:/);
    });
    it('rejects owner-only operations before touching the database', async () => {
        config.discord.ownerId = 'someone-else';
        const db = vi.spyOn(UserRepository, 'getOrCreate');
        const execute = vi.spyOn(commandMap.get('delete')!, 'execute');
        const request = interaction('delete', { id: 'vps-1' });
        await handleSlashCommand(request);
        expect(db).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining('Master Owner'));
    });
    it('blocks banned accounts', async () => {
        vi.spyOn(UserRepository, 'getOrCreate').mockResolvedValue({ is_banned: true } as any);
        const execute = vi.spyOn(commandMap.get('manage')!, 'execute');
        await handleSlashCommand(interaction('manage'));
        expect(execute).not.toHaveBeenCalled();
    });
    it('reports database failures after deferring instead of leaving the interaction unanswered', async () => {
        vi.spyOn(UserRepository, 'getOrCreate').mockRejectedValue(new Error('database offline'));
        const request = interaction('manage');
        await handleSlashCommand(request);
        expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('database') }));
    });
    it('keeps help usable without the database', async () => {
        const db = vi.spyOn(UserRepository, 'getOrCreate');
        const request = interaction('help');
        await handleSlashCommand(request);
        expect(db).not.toHaveBeenCalled();
        expect(request.editReply).toHaveBeenCalled();
    });
    it('edits ephemeral progress replies using the interaction webhook', async () => {
        const request = interaction('backup');
        const message = createInteractionMessage(request);
        const progress = await message.reply('Starting...');
        await progress.edit({ content: null, embeds: [{ title: 'Complete' }] });
        expect(request.editReply).toHaveBeenLastCalledWith({ content: null, embeds: [{ title: 'Complete' }] });
        const followup = await message.reply('Extra');
        await followup.edit('Updated');
        expect(request.followUp).toHaveBeenCalledWith({ content: 'Extra', flags: MessageFlags.Ephemeral });
        expect(request.webhook.editMessage).toHaveBeenCalledWith('followup', { content: 'Updated' });
    });
});

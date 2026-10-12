import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInteraction } from '../src/bot/handlers/interactionHandler.js';
import { CreateSessionStore } from '../src/bot/state/createSessionStore.js';
import { config } from '../src/config/index.js';
import { UserRepository } from '../src/db/repositories/userRepository.js';
import { VpsRepository } from '../src/db/repositories/vpsRepository.js';
import { OsRepository } from '../src/db/repositories/osRepository.js';
import { JobQueue } from '../src/core/queue/jobQueue.js';
const originalOwner = config.discord.ownerId;
function button(customId: string, id = 'owner'): any {
    return { customId, user: { id }, isButton: () => true, isStringSelectMenu: () => false,
        reply: vi.fn().mockResolvedValue(undefined), deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
}
beforeEach(() => {
    config.discord.ownerId = 'owner';
    vi.spyOn(UserRepository, 'getById').mockResolvedValue({ is_banned: false } as any);
});
afterEach(() => { config.discord.ownerId = originalOwner; vi.restoreAllMocks(); });
describe('Discord interaction regressions', () => {
    it('reserves the VPS before its job and consumes duplicate confirmations', async () => {
        const token = CreateSessionStore.createSession({ ramMb: 512, cpuCores: 1, diskGb: 5, targetUserId: 'user', creatorUserId: 'owner', selectedOsId: 'debian-13' });
        vi.spyOn(OsRepository, 'getById').mockResolvedValue({ is_active: true } as any);
        const reserve = vi.spyOn(VpsRepository, 'reserve').mockResolvedValue({ id: 'vps-0001', ip_address: '10.0.3.50' } as any);
        const job = vi.spyOn(JobQueue, 'runJob').mockImplementation(async () => {
            expect(reserve).toHaveBeenCalledTimes(1);
        });
        await Promise.all([handleInteraction(button(`vps:confirm_create:${token}`)), handleInteraction(button(`vps:confirm_create:${token}`))]);
        expect(reserve).toHaveBeenCalledTimes(1);
        expect(job).toHaveBeenCalledTimes(1);
        expect(CreateSessionStore.getSession(token)).toBeUndefined();
    });
    it('prevents other users from cancelling a creation session', async () => {
        const token = CreateSessionStore.createSession({ ramMb: 512, cpuCores: 1, diskGb: 5, targetUserId: 'user', creatorUserId: 'owner' });
        const interaction = button(`vps:cancel_create:${token}`, 'other');
        await handleInteraction(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
        expect(CreateSessionStore.getSession(token)).toBeDefined();
        CreateSessionStore.removeSession(token);
    });
    it('blocks banned users from previously posted buttons', async () => {
        vi.mocked(UserRepository.getById).mockResolvedValue({ is_banned: true } as any);
        const getVps = vi.spyOn(VpsRepository, 'getById');
        await handleInteraction(button('vps:start:vps-0001', 'banned'));
        expect(getVps).not.toHaveBeenCalled();
    });
    it('blocks suspended VPS owners from restarting through old panels', async () => {
        vi.spyOn(VpsRepository, 'getById').mockResolvedValue({ id: 'vps-0001', owner_discord_id: 'user', status: 'suspended' } as any);
        const interaction = button('vps:start:vps-0001', 'user');
        await handleInteraction(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('VPS đang bị khóa') }));
        expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
});

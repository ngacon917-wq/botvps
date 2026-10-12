import { ChatInputCommandInteraction, Client, SlashCommandBuilder } from 'discord.js';
import { allCommands, commandMap } from './index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

type Option = {
    name: string; description: string; type?: 'integer' | 'user'; optional?: boolean;
    min?: number; max?: number; choices?: string[]; split?: boolean;
};
const id: Option = { name: 'id', description: 'ID VPS hoặc node' };
const user: Option = { name: 'user', description: 'Người dùng Discord', type: 'user' };
const ram: Option = { name: 'ram', description: 'RAM (MB)', type: 'integer', min: 256, max: 65536 };
const cpu: Option = { name: 'cpu', description: 'Số vCPU', type: 'integer', min: 1, max: 64 };
const disk: Option = { name: 'disk', description: 'Dung lượng (GB)', type: 'integer', min: 2, max: 2000 };
const state: Option = { name: 'state', description: 'Bật hoặc tắt', choices: ['on', 'off'] };
const publicPort: Option = { name: 'public_port', description: 'Cổng public', type: 'integer', min: 1024, max: 65535 };
const backup: Option = { name: 'backup_id', description: 'ID bản sao lưu' };

export const slashOptions: Record<string, Option[]> = {};
for (const name of ['help', 'list', 'resources', 'top', 'admin', 'nodes', 'allvps', 'audit', 'myvps', 'health', 'images', 'version', 'support']) slashOptions[name] = [];
for (const name of ['info', 'start', 'stop', 'restart', 'reinstall', 'delete', 'status', 'uptime', 'os', 'stats', 'usage', 'limits', 'sshx', 'terminal', 'sshxreset', 'sshxstop', 'sshxstatus', 'console', 'logs', 'ip', 'network', 'ports', 'dns', 'bandwidth', 'backup', 'backups', 'nodeinfo', 'noderemove', 'unsuspend', 'ai', 'fix']) slashOptions[name] = [id];
Object.assign(slashOptions, {
    create: [ram, cpu, disk, user],
    manage: [{ ...id, optional: true }],
    rename: [id, { name: 'name', description: 'Tên mới của VPS' }],
    transfer: [id, user], setowner: [id, user],
    resize: [id, ram, cpu, disk], setram: [id, ram], setcpu: [id, cpu], setdisk: [id, disk],
    exec: [id, { name: 'command', description: 'Tên chương trình trong allowlist' },
        { name: 'args', description: 'Tham số cách nhau bằng dấu cách', optional: true, split: true }],
    portadd: [id, publicPort, { name: 'private_port', description: 'Cổng trong VPS', type: 'integer', min: 1, max: 65535 },
        { name: 'protocol', description: 'Giao thức', choices: ['tcp', 'udp'], optional: true }],
    portremove: [id, publicPort],
    setdns: [id, { name: 'resolver', description: 'IP DNS chính' },
        { name: 'resolvers', description: 'Các IP DNS bổ sung, cách nhau bằng dấu cách', optional: true, split: true }],
    ping: [id, { name: 'host', description: 'Địa chỉ cần ping' }],
    restore: [id, backup], backupdelete: [backup], autobackup: [id, state],
    nodeadd: [id, { name: 'name', description: 'Tên node' }, { name: 'host', description: 'IP hoặc hostname của agent' },
        { name: 'port', description: 'Cổng agent', type: 'integer', min: 1, max: 65535 },
        { name: 'token', description: 'API token của agent' }],
    maintenance: [id, state],
    suspend: [id, { name: 'reason', description: 'Lý do khóa VPS', optional: true }],
    setquota: [user, { name: 'vps', description: 'Số VPS tối đa', type: 'integer', min: 0 },
        { ...ram, min: 0 }, { ...cpu, min: 0 }, { ...disk, min: 0 }],
    banvps: [user], unbanvps: [user],
    profile: [{ ...user, optional: true }], quota: [{ ...user, optional: true }], notifications: [state],
} satisfies Record<string, Option[]>);

export function buildSlashCommands() {
    return allCommands.flatMap((command) => {
        const options = slashOptions[command.name];
        if (!options) throw new Error(`Missing slash options for ${command.name}`);
        const builder = new SlashCommandBuilder().setName(command.name).setDescription(command.description.slice(0, 100));
        for (const spec of options) {
            if (spec.type === 'user') {
                builder.addUserOption((option) => option.setName(spec.name).setDescription(spec.description).setRequired(!spec.optional));
            } else if (spec.type === 'integer') {
                builder.addIntegerOption((option) => {
                    option.setName(spec.name).setDescription(spec.description).setRequired(!spec.optional);
                    if (spec.min !== undefined) option.setMinValue(spec.min);
                    if (spec.max !== undefined) option.setMaxValue(spec.max);
                    return option;
                });
            } else {
                builder.addStringOption((option) => {
                    option.setName(spec.name).setDescription(spec.description).setRequired(!spec.optional);
                    if (spec.choices) option.addChoices(...spec.choices.map((value) => ({ name: value, value })));
                    return option;
                });
            }
        }
        const data = builder.toJSON();
        return [data, ...(command.aliases ?? []).map((name) => ({ ...data, name }))];
    });
}

export function getSlashArgs(interaction: ChatInputCommandInteraction): string[] {
    const specs = slashOptions[commandMap.get(interaction.commandName)?.name ?? interaction.commandName];
    if (!specs) throw new Error('Unknown slash command');
    return specs.flatMap((spec) => {
        const value = spec.type === 'user' ? interaction.options.getUser(spec.name, !spec.optional)?.id
            : spec.type === 'integer' ? interaction.options.getInteger(spec.name, !spec.optional)
            : interaction.options.getString(spec.name, !spec.optional);
        if (value === null || value === undefined) return [];
        return spec.split ? String(value).trim().split(/\s+/).filter(Boolean) : [String(value)];
    });
}

export async function registerSlashCommands(client: Client<true>): Promise<void> {
    const commands = buildSlashCommands();
    if (config.discord.guildId) await client.application.commands.set(commands, config.discord.guildId);
    else await client.application.commands.set(commands);
    logger.info(`Registered ${commands.length} slash commands (${config.discord.guildId || 'global'}).`);
}

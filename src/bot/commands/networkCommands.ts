import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { NatRepository } from '../../db/repositories/natRepository.js';
import { NodeAgentClient } from '../../agent/client.js';

export const networkCommands: Command[] = [
    // 1. ?ip <id>
    {
        name: 'ip',
        description: 'View IP address of VPS (Owner only)',
        usage: '?ip <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?ip <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const stats = await client.getStats(vps.id).catch(() => null);
            const activeIp = stats?.ip || vps.ip_address || 'Unassigned';

            await message.reply(`🌐 **IP Address for ${vps.id.toUpperCase()}:** \`${activeIp}\` (Internal Bridge)`);
        },
    },

    // 2. ?network <id>
    {
        name: 'network',
        description: 'Inspect network interfaces and packet statistics (Owner only)',
        usage: '?network <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?network <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const ipStats = await client.exec(vps.id, 'ip', ['-s', 'link']).catch(() => ({ stdout: 'N/A' }));

            await message.reply(`📡 **NETWORK INTERFACE STATS — ${vps.id.toUpperCase()}**\n\`\`\`\n${ipStats.stdout.slice(0, 1800)}\n\`\`\``);
        },
    },

    // 3. ?ports <id>
    {
        name: 'ports',
        description: 'List configured NAT port forwarding rules (Owner only)',
        usage: '?ports <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?ports <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const mappings = await NatRepository.getByVps(vps.id);
            if (mappings.length === 0) {
                await message.reply(`ℹ️ No NAT port mappings configured for **${vps.id.toUpperCase()}**.`);
                return;
            }

            const list = mappings.map((m) => `• Public Port **:${m.public_port}** ➔ Container **${vps.ip_address}:${m.private_port}** (${m.protocol.toUpperCase()})`);
            await message.reply(`🔌 **PORT FORWARDING RULES FOR ${vps.id.toUpperCase()}:**\n\n${list.join('\n')}`);
        },
    },

    // 4. ?portadd <id> <public> <private> [protocol]
    {
        name: 'portadd',
        description: 'Create a new NAT port forwarding rule (Owner only)',
        usage: '?portadd <id> <public_port> <private_port> [tcp/udp]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 3) {
                await message.reply('❌ Usage: `?portadd <id> <public_port> <private_port> [tcp/udp]`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const publicPort = parseInt(args[1], 10);
            const privatePort = parseInt(args[2], 10);
            const protocol = (args[3]?.toLowerCase() === 'udp' ? 'udp' : 'tcp') as 'tcp' | 'udp';

            if (isNaN(publicPort) || isNaN(privatePort)) {
                await message.reply('❌ Ports must be numeric.');
                return;
            }

            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                await client.addPortForward(vps.id, vps.ip_address, publicPort, privatePort, protocol);
                await message.reply(`✅ Added NAT port mapping: Public Port \`:${publicPort}\` ➔ \`${vps.ip_address}:${privatePort}\` (${protocol.toUpperCase()})`);
            } catch (err: any) {
                await message.reply(`❌ Failed to add NAT rule: ${err.message}`);
            }
        },
    },

    // 5. ?portremove <id> <public_port>
    {
        name: 'portremove',
        description: 'Delete a NAT port forwarding rule (Owner only)',
        usage: '?portremove <id> <public_port>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `?portremove <id> <public_port>`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const publicPort = parseInt(args[1], 10);
            if (isNaN(publicPort)) {
                await message.reply('❌ Public port must be numeric.');
                return;
            }

            const mappings = await NatRepository.getByVps(vps.id);
            const mapping = mappings.find((m) => m.public_port === publicPort);
            if (!mapping) {
                await message.reply(`❌ No mapping found for public port \`:${publicPort}\` on this VPS.`);
                return;
            }

            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                await client.removePortForward(vps.id, vps.ip_address, publicPort, mapping.private_port, mapping.protocol);
                await message.reply(`🗑️ Removed NAT port forward rule for public port \`:${publicPort}\`.`);
            } catch (err: any) {
                await message.reply(`❌ Failed to remove port mapping: ${err.message}`);
            }
        },
    },

    // 6. ?dns <id>
    {
        name: 'dns',
        description: 'Inspect active DNS resolvers inside container (Owner only)',
        usage: '?dns <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?dns <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const data = await client.getDns(vps.id);
            await message.reply(`🌐 **DNS Resolvers for ${vps.id.toUpperCase()}:**\n${data.resolvers.map((r: string) => `• \`${r}\``).join('\n')}`);
        },
    },

    // 7. ?setdns <id> <resolver...>
    {
        name: 'setdns',
        description: 'Configure DNS nameservers for VPS (Owner only)',
        usage: '?setdns <id> <resolver_1> [resolver_2...]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `?setdns <id> <resolver_1> [resolver_2]`\n*Example:* `?setdns vps-0001 1.1.1.1 8.8.8.8`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const resolvers = args.slice(1);
            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.setDns(vps.id, resolvers);

            await message.reply(`✅ Updated DNS resolvers for **${vps.id.toUpperCase()}**:\n${resolvers.map((r) => `• \`${r}\``).join('\n')}`);
        },
    },

    // 8. ?ping <id> <host>
    {
        name: 'ping',
        description: 'Test outbound network ping from container (Owner only)',
        usage: '?ping <id> <host>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `?ping <id> <host>`\n*Example:* `?ping vps-0001 1.1.1.1`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const host = args[1];
            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const res = await client.ping(vps.id, host);

            await message.reply(`📶 **Ping test from ${vps.id.toUpperCase()} to \`${host}\`:**\n\`\`\`\n${res.output}\n\`\`\``);
        },
    },

    // 9. ?bandwidth <id>
    {
        name: 'bandwidth',
        description: 'View container bandwidth throughput (Owner only)',
        usage: '?bandwidth <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`?bandwidth <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const res = await client.exec(vps.id, 'cat', ['/proc/net/dev']).catch(() => ({ stdout: 'N/A' }));

            await message.reply(`📊 **NETWORK BANDWIDTH STATISTICS — ${vps.id.toUpperCase()}:**\n\`\`\`\n${res.stdout.slice(0, 1800)}\n\`\`\``);
        },
    },
];

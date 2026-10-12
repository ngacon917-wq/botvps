import { Command } from './types.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { NodeAgentClient } from '../../agent/client.js';

export const sshxCommands: Command[] = [
    // 1. /sshx <id>
    {
        name: 'sshx',
        description: 'Generate private SSHX terminal session link (Owner only for direct command)',
        usage: '/sshx <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/sshx <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const waitMsg = await message.reply('⏳ Launching secure SSHX session inside container...');
            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                const res = await client.createSshxSession(vps.id, message.author.id);

                if (!res.success || !res.sessionUrl) {
                    await waitMsg.edit(`❌ Failed to start SSHX: ${res.error || 'Unknown error'}`);
                    return;
                }

                // Send terminal link via private DM to protect access secret
                const dmChannel = await message.author.createDM();
                await dmChannel.send(
                    `🖥️ **SECURE SSHX TERMINAL SESSION FOR ${vps.id.toUpperCase()}**\n\n` +
                    `🔗 **Access URL:** <${res.sessionUrl}>\n\n` +
                    `⚠️ *Keep this link confidential. Do not share it publicly. You can revoke it anytime using \`/sshxstop ${vps.id}\`.*`
                );

                await waitMsg.edit(`✅ Secure SSHX terminal session created! **Check your Direct Messages (DM)** for the private access URL.`);
            } catch (err: any) {
                await waitMsg.edit(`❌ Error creating SSHX terminal: ${err.message}`);
            }
        },
    },

    // 2. /terminal <id>
    {
        name: 'terminal',
        description: 'Open terminal panel instructions (Owner only)',
        usage: '/terminal <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/terminal <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            await message.reply(
                `🖥️ **TERMINAL CONTROL FOR ${vps.id.toUpperCase()}:**\n` +
                `• To launch a web terminal session: \`/sshx ${vps.id}\`\n` +
                `• To check if SSHX is active: \`/sshxstatus ${vps.id}\`\n` +
                `• To terminate active session: \`/sshxstop ${vps.id}\`\n` +
                `• To reset session: \`/sshxreset ${vps.id}\``
            );
        },
    },

    // 3. /sshxreset <id>
    {
        name: 'sshxreset',
        description: 'Revoke old session and issue new SSHX session (Owner only)',
        usage: '/sshxreset <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/sshxreset <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const waitMsg = await message.reply('🔄 Revoking old session and regenerating SSHX...');
            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                await client.stopSshxSession(vps.id).catch(() => {});
                const res = await client.createSshxSession(vps.id, message.author.id);

                if (!res.success || !res.sessionUrl) {
                    await waitMsg.edit(`❌ Failed to reset SSHX: ${res.error || 'Unknown error'}`);
                    return;
                }

                const dmChannel = await message.author.createDM();
                await dmChannel.send(`🔄 **NEW REGENERATED SSHX SESSION FOR ${vps.id.toUpperCase()}:**\n<${res.sessionUrl}>`);
                await waitMsg.edit('✅ Old session revoked and new SSHX link sent to your Direct Messages.');
            } catch (err: any) {
                await waitMsg.edit(`❌ Error: ${err.message}`);
            }
        },
    },

    // 4. /sshxstop <id>
    {
        name: 'sshxstop',
        description: 'Terminate active SSHX session inside container (Owner only)',
        usage: '/sshxstop <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/sshxstop <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            await client.stopSshxSession(vps.id);
            await message.reply(`🛑 Terminated active SSHX session for **${vps.id.toUpperCase()}**.`);
        },
    },

    // 5. /sshxstatus <id>
    {
        name: 'sshxstatus',
        description: 'Check whether SSHX process is running inside container (Owner only)',
        usage: '/sshxstatus <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/sshxstatus <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const status = await client.getSshxStatus(vps.id);
            await message.reply(
                `🖥️ **SSHX Status for ${vps.id.toUpperCase()}:** ${status.active ? '🟢 ACTIVE & RUNNING' : '🔴 INACTIVE / STOPPED'}`
            );
        },
    },

    // 6. /console <id>
    {
        name: 'console',
        description: 'View container console output (Owner only)',
        usage: '/console <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/console <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const data = await client.getLogs(vps.id, 25);
            const logSnippet = (data.logs || 'No output').slice(-1800);
            await message.reply(`📜 **CONSOLE OUTPUT FOR ${vps.id.toUpperCase()}:**\n\`\`\`\n${logSnippet}\n\`\`\``);
        },
    },

    // 7. /exec <id> <command>
    {
        name: 'exec',
        description: 'Run an allowed inspection command inside the container (Owner only)',
        usage: '/exec <id> <command> [args...]',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (args.length < 2) {
                await message.reply('❌ Usage: `/exec <id> <command> [args...]`\n*Allowed commands:* `uptime`, `df`, `free`, `cat`, `ps`, `uname`, `ping`, `top`, `curl`, `ip`, `systemctl`, `date`');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const cmd = args[1];
            const cmdArgs = args.slice(2);

            try {
                const client = await NodeAgentClient.getClientForNode(vps.node_id);
                const res = await client.exec(vps.id, cmd, cmdArgs);
                const out = (res.stdout || res.stderr || 'Command executed with no output.').slice(0, 1800);
                await message.reply(`🖥️ **Execution result in ${vps.id.toUpperCase()} (\`${cmd}\`):**\n\`\`\`\n${out}\n\`\`\``);
            } catch (err: any) {
                await message.reply(`❌ Exec failed: ${err.message}`);
            }
        },
    },

    // 8. /logs <id>
    {
        name: 'logs',
        description: 'Inspect LXC container logs (Owner only)',
        usage: '/logs <id>',
        ownerOnly: true,
        execute: async ({ message, args }) => {
            if (!args[0]) {
                await message.reply('❌ Please specify a VPS ID (`/logs <id>`).');
                return;
            }
            const vps = await VpsRepository.getById(args[0]);
            if (!vps) {
                await message.reply(`❌ VPS \`${args[0]}\` not found.`);
                return;
            }

            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const data = await client.getLogs(vps.id, 30);
            const logSnippet = (data.logs || 'No log entries.').slice(-1800);
            await message.reply(`📋 **LXC LOGS FOR ${vps.id.toUpperCase()}:**\n\`\`\`\n${logSnippet}\n\`\`\``);
        },
    },
];

import { Interaction } from 'discord.js';
import { config, isOwner } from '../../config/index.js';
import { VpsRepository } from '../../db/repositories/vpsRepository.js';
import { OsRepository } from '../../db/repositories/osRepository.js';
import { NodeAgentClient } from '../../agent/client.js';
import { CreateSessionStore } from '../state/createSessionStore.js';
import { VpsEmbeds } from '../ui/embeds.js';
import { VpsComponents } from '../ui/components.js';
import { JobQueue } from '../../core/queue/jobQueue.js';
import { AuditRepository } from '../../db/repositories/auditRepository.js';
import { UserRepository } from '../../db/repositories/userRepository.js';
import { logger } from '../../utils/logger.js';

export async function handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
    const user = await UserRepository.getById(interaction.user.id);
    if (user?.is_banned) {
        await interaction.reply({ content: '⛔ Tài khoản của bạn đã bị khóa quyền sử dụng VPS.', ephemeral: true });
        return;
    }
    if (interaction.isStringSelectMenu()) {
        const customId = interaction.customId;

        // 1. OS Selection during Create
        if (customId.startsWith('create:os:')) {
            const token = customId.replace('create:os:', '');
            const session = CreateSessionStore.getSession(token);

            if (!session) {
                await interaction.reply({ content: '❌ Phiên tạo VPS đã hết hạn hoặc không tồn tại.', ephemeral: true });
                return;
            }

            if (!isOwner(interaction.user.id) && interaction.user.id !== session.creatorUserId) {
                await interaction.reply({ content: '❌ Bạn không có quyền thao tác trên phiên tạo VPS này.', ephemeral: true });
                return;
            }

            const selectedOs = interaction.values[0];
            CreateSessionStore.updateOs(token, selectedOs);
            const osRecord = await OsRepository.getById(selectedOs);

            const confirmRow = VpsComponents.createConfirmButtons(token);
            await interaction.update({
                content: `✅ Đã chọn hệ điều hành: **${osRecord?.name || selectedOs}**.\nNhấn nút bên dưới để tiến hành tạo VPS thực tế trên hệ thống:`,
                components: [confirmRow],
            });
            return;
        }

        // 2. Select VPS to manage
        if (customId === 'vps:select_panel') {
            const vpsId = interaction.values[0];
            const vps = await VpsRepository.getById(vpsId);
            if (!vps) {
                await interaction.reply({ content: '❌ Không tìm thấy VPS.', ephemeral: true });
                return;
            }

            const callerIsOwner = isOwner(interaction.user.id);
            if (!callerIsOwner && vps.owner_discord_id !== interaction.user.id) {
                await interaction.reply({ content: '❌ Bạn không có quyền quản lý VPS này.', ephemeral: true });
                return;
            }

            await interaction.deferUpdate();
            const client = await NodeAgentClient.getClientForNode(vps.node_id);
            const stats = await client.getStats(vps.id).catch(() => null);
            const isRunning = (stats?.status ?? vps.status) === 'running';

            const embed = VpsEmbeds.vpsPanel(vps, stats);
            const buttons = VpsComponents.manageButtons(vps.id, isRunning);

            await interaction.editReply({
                content: null,
                embeds: [embed],
                components: buttons,
            });
            return;
        }

        // 3. Select OS for Reinstall
        if (customId.startsWith('reinstall:select_os:')) {
            const vpsId = customId.replace('reinstall:select_os:', '');
            const vps = await VpsRepository.getById(vpsId);
            if (!vps) {
                await interaction.reply({ content: '❌ VPS không tồn tại.', ephemeral: true });
                return;
            }

            const callerIsOwner = isOwner(interaction.user.id);
            if (!callerIsOwner && vps.owner_discord_id !== interaction.user.id) {
                await interaction.reply({ content: '❌ Bạn không có quyền cài lại VPS này.', ephemeral: true });
                return;
            }

            const selectedOsId = interaction.values[0];
            const osRecord = await OsRepository.getById(selectedOsId);
            const warningEmbed = VpsEmbeds.reinstallWarning(vps.id, osRecord?.name || selectedOsId);
            const confirmRow = VpsComponents.reinstallConfirmButtons(vps.id, selectedOsId);

            await interaction.update({
                embeds: [warningEmbed],
                components: [confirmRow],
            });
            return;
        }
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;

        // A. Confirm Create VPS
        if (customId.startsWith('vps:confirm_create:')) {
            const token = customId.replace('vps:confirm_create:', '');
            const session = CreateSessionStore.getSession(token);

            if (!session || !session.selectedOsId) {
                await interaction.reply({ content: '❌ Phiên tạo VPS không hợp lệ hoặc đã hết hạn.', ephemeral: true });
                return;
            }

            if (!isOwner(interaction.user.id)) {
                await interaction.reply({ content: '❌ Chỉ Master Owner mới có quyền tạo VPS.', ephemeral: true });
                return;
            }

            // Consume synchronously so duplicate clicks cannot provision twice.
            CreateSessionStore.removeSession(token);
            await interaction.deferUpdate();
            let nextVpsId: string | undefined;
            try {
                const osRecord = await OsRepository.getById(session.selectedOsId);
                if (!osRecord?.is_active) throw new Error('Selected OS is unavailable.');
                const vpsRecord = await VpsRepository.reserve({
                    nodeId: config.agent.nodeId, ownerDiscordId: session.targetUserId,
                    osId: session.selectedOsId, ramMb: session.ramMb,
                    cpuCores: session.cpuCores, diskGb: session.diskGb,
                });
                nextVpsId = vpsRecord.id;
                const reservedId = vpsRecord.id;
                const nextIp = vpsRecord.ip_address;
                await JobQueue.runJob({
                    jobId: `job-create-${Date.now()}`,
                    vpsId: reservedId,
                    action: 'create',
                    requestedBy: interaction.user.id,
                    handler: async (updateStage) => {
                        await interaction.editReply({ content: `⏳ **[1/5] Đang kiểm tra tính tương thích và tài nguyên node...**`, components: [] });
                        await updateStage('validating');

                        const client = await NodeAgentClient.getClientForNode(config.agent.nodeId);
                        const comp = await client.checkCompatibility();
                        if (!comp.compatible) {
                            throw new Error(`Node không tương thích tạo LXC: ${comp.issues.join('; ')}`);
                        }

                        await interaction.editReply({ content: `⏳ **[2/5] Đang tạo container LXC (${osRecord?.name || session.selectedOsId})...**`, components: [] });
                        await updateStage('provisioning');

                        await client.createVps({
                            id: reservedId,
                            distro: osRecord?.distro || 'debian',
                            release: osRecord?.release || 'trixie',
                            arch: osRecord?.arch || 'amd64',
                            ramMb: session.ramMb,
                            cpuCores: session.cpuCores,
                            diskGb: session.diskGb,
                            ipAddress: nextIp,
                        });

                        await interaction.editReply({ content: `⏳ **[3/5] Đang cấu hình cgroups, RAM, CPU và network...**`, components: [] });
                        await updateStage('configuring');

                        await interaction.editReply({ content: `⏳ **[4/5] Đang khởi động VPS và cài đặt SSHX...**`, components: [] });
                        await updateStage('starting');
                        await client.startVps(reservedId);

                        // Install and start SSHX
                        const sshxRes = await client.createSshxSession(reservedId, session.targetUserId);

                        await updateStage('saving');
                        await VpsRepository.updateStatus(reservedId, 'running');
                        vpsRecord.status = 'running';

                        // Send DM to target user with private terminal access
                        let dmSent = false;
                        const targetUser = await interaction.client.users.fetch(session.targetUserId).catch(() => null);
                        if (targetUser && sshxRes.sessionUrl) {
                            const dm = await targetUser.createDM().catch(() => null);
                            if (dm) {
                                await dm.send(
                                    `🎉 **BẠN ĐÃ NHẬN ĐƯỢC VPS MỚI (${reservedId.toUpperCase()})!**\n\n` +
                                    `• **RAM:** \`${session.ramMb} MB\`\n` +
                                    `• **CPU:** \`${session.cpuCores} vCPU\`\n` +
                                    `• **Disk:** \`${session.diskGb} GB\`\n` +
                                    `• **OS:** \`${osRecord?.name || session.selectedOsId}\`\n\n` +
                                    `🖥️ **LINK TERMINAL SSHX:** <${sshxRes.sessionUrl}>\n` +
                                    `*(Vui lòng bảo mật link này. Bạn có thể sử dụng lệnh \`/manage\` trong Discord để quản lý VPS)*`
                                ).then(() => { dmSent = true; }).catch(() => {});
                            }
                        }

                        CreateSessionStore.removeSession(token);

                        const panelEmbed = VpsEmbeds.vpsPanel(vpsRecord);
                        const buttons = VpsComponents.manageButtons(vpsRecord.id, true);

                        await interaction.editReply({
                            content: `✅ **VPS ${reservedId.toUpperCase()} ĐÃ ĐƯỢC TẠO THÀNH CÔNG!** Đã cấp quyền cho <@${session.targetUserId}>. ${dmSent ? 'Đã gửi thông tin qua tin nhắn riêng.' : 'Chưa gửi được terminal qua DM. Dùng nút SSHX trong bảng quản lý để thử lại.'}`,
                            embeds: [panelEmbed],
                            components: buttons,
                        });

                        await AuditRepository.log({
                            userDiscordId: interaction.user.id,
                            action: 'vps_create',
                            targetType: 'vps',
                            targetId: reservedId,
                            details: { owner: session.targetUserId, ram: session.ramMb, cpu: session.cpuCores },
                        });
                    },
                });
            } catch (err: any) {
                if (nextVpsId) await VpsRepository.updateStatus(nextVpsId, 'error').catch(() => {});
                logger.error(`VPS create job failed: ${err.message}`);
                await interaction.editReply({ content: `❌ Tạo VPS thất bại: ${err.message}`, components: [] });
            }
            return;
        }

        // B. Cancel Create
        if (customId.startsWith('vps:cancel_create:')) {
            const token = customId.replace('vps:cancel_create:', '');
            const session = CreateSessionStore.getSession(token);
            if (!isOwner(interaction.user.id) && session?.creatorUserId !== interaction.user.id) {
                await interaction.reply({ content: '❌ Bạn không có quyền hủy phiên này.', ephemeral: true });
                return;
            }
            CreateSessionStore.removeSession(token);
            await interaction.update({ content: '🚫 Đã hủy tạo VPS.', embeds: [], components: [] });
            return;
        }

        // Parse standard VPS actions: "vps:<action>:<vpsId>"
        const parts = customId.split(':');
        if (parts.length >= 3 && parts[0] === 'vps') {
            const action = parts[1];
            const vpsId = parts[2];
            const vps = await VpsRepository.getById(vpsId);

            if (!vps) {
                await interaction.reply({ content: '❌ Không tìm thấy VPS này.', ephemeral: true });
                return;
            }

            const callerIsOwner = isOwner(interaction.user.id);
            if (!callerIsOwner && vps.owner_discord_id !== interaction.user.id) {
                await interaction.reply({ content: '❌ Bạn không có quyền thao tác trên VPS này!', ephemeral: true });
                return;
            }

            if (!callerIsOwner && vps.status === 'suspended') {
                await interaction.reply({ content: '⛔ VPS đang bị khóa. Vui lòng liên hệ quản trị viên.', ephemeral: true });
                return;
            }
            const client = await NodeAgentClient.getClientForNode(vps.node_id);

            // 1. Start Button
            if (action === 'start') {
                await interaction.deferUpdate();
                try {
                    await client.startVps(vps.id);
                    await VpsRepository.updateStatus(vps.id, 'running');
                    const stats = await client.getStats(vps.id).catch(() => null);
                    const embed = VpsEmbeds.vpsPanel(vps, stats);
                    const buttons = VpsComponents.manageButtons(vps.id, true);
                    await interaction.editReply({ embeds: [embed], components: buttons });
                } catch (err: any) {
                    await interaction.followUp({ content: `❌ Không thể khởi động VPS: ${err.message}`, ephemeral: true });
                }
                return;
            }

            // 2. Stop Button
            if (action === 'stop') {
                await interaction.deferUpdate();
                try {
                    await client.stopVps(vps.id);
                    await VpsRepository.updateStatus(vps.id, 'stopped');
                    const stats = await client.getStats(vps.id).catch(() => null);
                    const embed = VpsEmbeds.vpsPanel(vps, stats);
                    const buttons = VpsComponents.manageButtons(vps.id, false);
                    await interaction.editReply({ embeds: [embed], components: buttons });
                } catch (err: any) {
                    await interaction.followUp({ content: `❌ Không thể tắt VPS: ${err.message}`, ephemeral: true });
                }
                return;
            }

            // 3. Restart Button
            if (action === 'restart') {
                await interaction.deferUpdate();
                try {
                    await client.restartVps(vps.id);
                    await VpsRepository.updateStatus(vps.id, 'running');
                    const stats = await client.getStats(vps.id).catch(() => null);
                    const embed = VpsEmbeds.vpsPanel(vps, stats);
                    const buttons = VpsComponents.manageButtons(vps.id, true);
                    await interaction.editReply({ embeds: [embed], components: buttons });
                } catch (err: any) {
                    await interaction.followUp({ content: `❌ Không thể khởi động lại VPS: ${err.message}`, ephemeral: true });
                }
                return;
            }

            // 4. Open SSHX Terminal (MUST BE EPHEMERAL OR DM!)
            if (action === 'sshx') {
                await interaction.deferReply({ ephemeral: true });
                try {
                    const sshxRes = await client.createSshxSession(vps.id, interaction.user.id);
                    if (!sshxRes.success || !sshxRes.sessionUrl) {
                        await interaction.editReply({ content: `❌ Không thể tạo phiên SSHX: ${sshxRes.error || 'Unknown error'}` });
                        return;
                    }

                    await interaction.editReply({
                        content: `🖥️ **PHIÊN TERMINAL SSHX CHO ${vps.id.toUpperCase()}:**\n\n` +
                                 `🔗 **Link truy cập:** <${sshxRes.sessionUrl}>\n\n` +
                                 `⚠️ *Link terminal này chỉ hiển thị riêng cho bạn (ephemeral). Không chia sẻ công khai!*`,
                    });
                } catch (err: any) {
                    await interaction.editReply({ content: `❌ Lỗi mở SSHX: ${err.message}` });
                }
                return;
            }

            // 5. Reinstall Prompt
            if (action === 'reinstall_prompt') {
                const menu = VpsComponents.osSelectMenu(`reinstall:select_os:${vps.id}`);
                await interaction.update({
                    content: `💿 **CHỌN HỆ ĐIỀU HÀNH CẦN CÀI LẠI CHO VPS ${vps.id.toUpperCase()}**:`,
                    embeds: [],
                    components: [menu],
                });
                return;
            }

            // 6. Confirm Reinstall (Destructive Action!)
            if (action === 'confirm_reinstall') {
                const targetOsId = parts[3];
                const osRecord = await OsRepository.getById(targetOsId);

                await interaction.deferUpdate();
                try {
                    await JobQueue.runJob({
                        jobId: `job-reinstall-${Date.now()}`,
                        vpsId: vps.id,
                        action: 'reinstall',
                        requestedBy: interaction.user.id,
                        handler: async (updateStage) => {
                            await interaction.editReply({
                                content: `⏳ **Đang cài lại VPS ${vps.id.toUpperCase()} với ${osRecord?.name || targetOsId}...** Vui lòng đợi trong giây lát.`,
                                embeds: [],
                                components: [],
                            });

                            await updateStage('reinstalling');
                            await client.reinstallVps(vps.id, {
                                distro: osRecord?.distro || 'debian',
                                release: osRecord?.release || 'trixie',
                                arch: osRecord?.arch || 'amd64',
                                ramMb: vps.ram_mb,
                                cpuCores: vps.cpu_cores,
                                diskGb: vps.disk_gb,
                                ipAddress: vps.ip_address,
                            });

                            await updateStage('starting_and_sshx');
                            const sshxRes = await client.createSshxSession(vps.id, vps.owner_discord_id);
                            await VpsRepository.updateOs(vps.id, targetOsId);
                            await VpsRepository.updateStatus(vps.id, 'running');

                            const updatedVps = await VpsRepository.getById(vps.id);
                            const stats = await client.getStats(vps.id).catch(() => null);
                            const embed = VpsEmbeds.vpsPanel(updatedVps || vps, stats);
                            const buttons = VpsComponents.manageButtons(vps.id, true);

                            await interaction.editReply({
                                content: `✅ **VPS ${vps.id.toUpperCase()} ĐÃ ĐƯỢC CÀI LẠI THÀNH CÔNG!** Đã xóa sạch dữ liệu cũ và cài hệ điều hành mới.`,
                                embeds: [embed],
                                components: buttons,
                            });

                            // DM owner new SSHX URL
                            const ownerUser = await interaction.client.users.fetch(vps.owner_discord_id).catch(() => null);
                            if (ownerUser && sshxRes.sessionUrl) {
                                const dm = await ownerUser.createDM().catch(() => null);
                                dm?.send(`🔄 **VPS ${vps.id.toUpperCase()} đã cài lại thành công!** Link SSHX mới: <${sshxRes.sessionUrl}>`).catch(() => {});
                            }
                        },
                    });
                } catch (err: any) {
                    await interaction.editReply({ content: `❌ Cài lại VPS thất bại: ${err.message}`, components: [] });
                }
                return;
            }

            // 7. Statistics
            if (action === 'stats') {
                await interaction.deferReply({ ephemeral: true });
                const stats = await client.getStats(vps.id).catch(() => null);
                await interaction.editReply({
                    content: `📊 **Thống kê thực tế ${vps.id.toUpperCase()}:**\n` +
                             `• Trạng thái: \`${stats?.status || vps.status}\`\n` +
                             `• RAM Đang dùng: \`${stats?.ramUsedMb || 0} MB / ${vps.ram_mb} MB\`\n` +
                             `• CPU vCPU: \`${vps.cpu_cores} Cores\`\n` +
                             `• Dung lượng đĩa: \`${vps.disk_gb} GB\``,
                });
                return;
            }

            // AI Diagnose Button
            if (action === 'ai') {
                await interaction.deferReply({ ephemeral: true });
                const { LxcManager } = await import('../../core/lxc/lxcManager.js');
                const { AiDiagnosticAgent } = await import('../../core/ai/diagnostics.js');
                const lxcManager = new LxcManager();
                const report = await AiDiagnosticAgent.diagnoseContainer(vps.id, lxcManager);
                const embed = VpsEmbeds.aiDiagnosticReport(report);
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // 8. Refresh
            if (action === 'refresh') {
                await interaction.deferUpdate();
                const stats = await client.getStats(vps.id).catch(() => null);
                const isRunning = (stats?.status ?? vps.status) === 'running';
                const embed = VpsEmbeds.vpsPanel(vps, stats);
                const buttons = VpsComponents.manageButtons(vps.id, isRunning);
                await interaction.editReply({ embeds: [embed], components: buttons });
                return;
            }

            // 9. Cancel / Return to Panel
            if (action === 'cancel') {
                await interaction.deferUpdate();
                const stats = await client.getStats(vps.id).catch(() => null);
                const isRunning = (stats?.status ?? vps.status) === 'running';
                const embed = VpsEmbeds.vpsPanel(vps, stats);
                const buttons = VpsComponents.manageButtons(vps.id, isRunning);
                await interaction.editReply({ content: null, embeds: [embed], components: buttons });
                return;
            }
        }
    }
}

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { VpsRecord } from '../../db/repositories/vpsRepository.js';

export class VpsComponents {
    /**
     * Dropdown menu for selecting OS during create or reinstall
     */
    static osSelectMenu(customId: string): ActionRowBuilder<StringSelectMenuBuilder> {
        const select = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder('👉 Choose Operating System...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Debian 13 (Trixie)')
                    .setDescription('Debian GNU/Linux 13 Testing/Next Stable')
                    .setValue('debian-13')
                    .setEmoji('🍥'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Debian 12 (Bookworm)')
                    .setDescription('Debian GNU/Linux 12 Stable')
                    .setValue('debian-12')
                    .setEmoji('🍥'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Ubuntu 24.04 LTS (Noble)')
                    .setDescription('Ubuntu LTS Long Term Support')
                    .setValue('ubuntu-2404')
                    .setEmoji('🐧'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Ubuntu 22.04 LTS (Jammy)')
                    .setDescription('Ubuntu LTS Long Term Support')
                    .setValue('ubuntu-2204')
                    .setEmoji('🐧'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Alpine Linux 3.20')
                    .setDescription('Lightweight security-oriented Linux')
                    .setValue('alpine-320')
                    .setEmoji('🏔️')
            );

        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    }

    /**
     * Buttons for VPS Management Panel
     */
    static manageButtons(vpsId: string, isRunning: boolean): ActionRowBuilder<ButtonBuilder>[] {
        const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`vps:start:${vpsId}`)
                .setLabel('Start')
                .setEmoji('🟢')
                .setStyle(ButtonStyle.Success)
                .setDisabled(isRunning),
            new ButtonBuilder()
                .setCustomId(`vps:stop:${vpsId}`)
                .setLabel('Stop')
                .setEmoji('🔴')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!isRunning),
            new ButtonBuilder()
                .setCustomId(`vps:restart:${vpsId}`)
                .setLabel('Restart')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!isRunning),
            new ButtonBuilder()
                .setCustomId(`vps:sshx:${vpsId}`)
                .setLabel('Open SSHX')
                .setEmoji('🖥️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!isRunning)
        );

        const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`vps:reinstall_prompt:${vpsId}`)
                .setLabel('Reinstall OS')
                .setEmoji('💿')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`vps:stats:${vpsId}`)
                .setLabel('Statistics')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`vps:ai:${vpsId}`)
                .setLabel('AI Diagnose')
                .setEmoji('🤖')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`vps:refresh:${vpsId}`)
                .setLabel('Refresh')
                .setEmoji('🔃')
                .setStyle(ButtonStyle.Secondary)
        );

        return [row1, row2];
    }

    /**
     * Dropdown menu for selecting between multiple VPS owned by a user
     */
    static vpsSelectMenu(vpsList: VpsRecord[], customId: string = 'vps:select_panel'): ActionRowBuilder<StringSelectMenuBuilder> {
        const select = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder('👉 Select a VPS to manage...');

        for (const vps of vpsList.slice(0, 25)) {
            const statusIcon = vps.status === 'running' ? '🟢' : '🔴';
            select.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${vps.id.toUpperCase()} — ${vps.name}`)
                    .setDescription(`RAM: ${vps.ram_mb}MB | CPU: ${vps.cpu_cores} | Disk: ${vps.disk_gb}GB`)
                    .setValue(vps.id)
                    .setEmoji(statusIcon)
            );
        }

        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    }

    /**
     * Reinstall confirmation action row
     */
    static reinstallConfirmButtons(vpsId: string, osId: string): ActionRowBuilder<ButtonBuilder> {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`vps:confirm_reinstall:${vpsId}:${osId}`)
                .setLabel('Confirm Reinstall (Wipe All Data)')
                .setEmoji('⚠️')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`vps:cancel:${vpsId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    /**
     * Create confirmation action row
     */
    static createConfirmButtons(token: string): ActionRowBuilder<ButtonBuilder> {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`vps:confirm_create:${token}`)
                .setLabel('Confirm Create VPS')
                .setEmoji('🚀')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`vps:cancel_create:${token}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );
    }
}

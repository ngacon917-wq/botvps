import { Command } from './types.js';
import { vpsLifecycleCommands } from './vpsLifecycleCommands.js';
import { resourceCommands } from './resourceCommands.js';
import { sshxCommands } from './sshxCommands.js';
import { networkCommands } from './networkCommands.js';
import { backupCommands } from './backupCommands.js';
import { adminCommands } from './adminCommands.js';
import { utilityCommands } from './utilityCommands.js';

export const allCommands: Command[] = [
    ...vpsLifecycleCommands,
    ...resourceCommands,
    ...sshxCommands,
    ...networkCommands,
    ...backupCommands,
    ...adminCommands,
    ...utilityCommands,
];

export const commandMap = new Map<string, Command>();

for (const cmd of allCommands) {
    commandMap.set(cmd.name.toLowerCase(), cmd);
    if (cmd.aliases) {
        for (const alias of cmd.aliases) {
            commandMap.set(alias.toLowerCase(), cmd);
        }
    }
}

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

dotenv.config();

// Helper to auto-generate or retrieve local machine agent secret
function getOrCreateAgentToken(): string {
    if (process.env.AGENT_API_TOKEN && process.env.AGENT_API_TOKEN.trim().length > 0) {
        return process.env.AGENT_API_TOKEN.trim();
    }

    const secretPaths = [
        path.resolve(process.cwd(), '.agent_secret'),
        '/var/lib/vpsbot/.agent_secret',
    ];

    for (const sp of secretPaths) {
        try {
            if (fs.existsSync(sp)) {
                const token = fs.readFileSync(sp, 'utf8').trim();
                if (token.length > 0) return token;
            }
        } catch {}
    }

    // Auto-generate a secure random 64-char token and save locally
    const generated = crypto.randomBytes(32).toString('hex');
    try {
        const targetPath = secretPaths[0];
        fs.writeFileSync(targetPath, generated, { mode: 0o600 });
    } catch {}

    return generated;
}

export interface AppConfig {
    discord: {
        token: string;
        clientId: string;
        ownerId: string; // The ONLY owner allowed to perform admin/create tasks
        prefix: string;
        guildId: string;
        enablePrefixCommands: boolean;
    };
    db: {
        connectionString?: string;
        host: string;
        port: number;
        user: string;
        password?: string;
        database: string;
    };
    agent: {
        nodeId: string;
        host: string;
        port: number;
        apiToken: string;
        lxcPath: string;
        backupPath: string;
        bridgeInterface: string;
        sshxBin: string;
    };
    logLevel: string;
}

export const config: AppConfig = {
    discord: {
        token: process.env.DISCORD_TOKEN || '',
        clientId: process.env.DISCORD_CLIENT_ID || '',
        ownerId: process.env.OWNER_DISCORD_ID || '',
        prefix: process.env.PREFIX || '?',
        guildId: process.env.DISCORD_GUILD_ID?.trim() || '',
        enablePrefixCommands: process.env.ENABLE_PREFIX_COMMANDS === 'true',
    },
    db: {
        connectionString: process.env.DATABASE_URL,
        host: process.env.PGHOST || (fs.existsSync('/var/run/postgresql') ? '/var/run/postgresql' : '127.0.0.1'),
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER || os.userInfo().username,
        password: process.env.PGPASSWORD || undefined,
        database: process.env.PGDATABASE || 'vpsbot',
    },
    agent: {
        nodeId: process.env.NODE_ID || 'node-1',
        host: process.env.AGENT_HOST || '127.0.0.1',
        port: parseInt(process.env.AGENT_PORT || '4000', 10),
        apiToken: getOrCreateAgentToken(),
        lxcPath: process.env.LXC_PATH || '/var/lib/lxc',
        backupPath: process.env.BACKUP_PATH || '/var/lib/vpsbot/backups',
        bridgeInterface: process.env.BRIDGE_INTERFACE || 'lxcbr0',
        sshxBin: process.env.SSHX_BIN || '/usr/local/bin/sshx',
    },
    logLevel: process.env.LOG_LEVEL || 'info',
};

export function isOwner(userId: string): boolean {
    if (!config.discord.ownerId) return false;
    return config.discord.ownerId.trim() === userId.trim();
}

import winston from 'winston';
import { config } from '../config/index.js';

// Sensitive keys/patterns to mask
const SENSITIVE_PATTERNS = [
    /(?:token|secret|password|key)=([^\s&]+)/gi,
    /https:\/\/sshx\.io\/s\/[a-zA-Z0-9_-]+/gi,
    /Bot\s+[a-zA-Z0-9_\.-]+/gi,
];

const maskSensitiveData = winston.format((info) => {
    let msg: string = String(info.message ?? '');
    if (msg) {
        msg = msg.replace(/https:\/\/sshx\.io\/s\/([a-zA-Z0-9_-]+)/gi, 'https://sshx.io/s/[REDACTED_SECRET]');
        if (config.discord.token) {
            msg = msg.split(config.discord.token).join('[REDACTED_DISCORD_TOKEN]');
        }
        if (config.agent.apiToken) {
            msg = msg.split(config.agent.apiToken).join('[REDACTED_AGENT_TOKEN]');
        }
        info.message = msg;
    }
    return info;
});

export const logger = winston.createLogger({
    level: config.logLevel || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        maskSensitiveData(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] [${level.toUpperCase()}]: ${message}${metaStr}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                maskSensitiveData(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `[${timestamp}] [${level}]: ${message}${metaStr}`;
                })
            ),
        }),
    ],
});

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

function getPoolConfig(): pg.PoolConfig {
    if (config.db.connectionString) {
        return { connectionString: config.db.connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
    }

    const isUnixSocket = config.db.host.startsWith('/');
    const poolConfig: pg.PoolConfig = {
        host: config.db.host,
        user: config.db.user,
        database: config.db.database,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

    if (!isUnixSocket) {
        poolConfig.port = config.db.port;
    }

    if (config.db.password) {
        poolConfig.password = config.db.password;
    }

    return poolConfig;
}

export const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
    logger.error(`Unexpected error on idle PostgreSQL client: ${err.message}`);
});

export async function initDatabase(): Promise<void> {
    logger.info('Initializing PostgreSQL database schema...');
    try {
        const client = await pool.connect();
        try {
            // Read schema file
            const currentDir = path.dirname(fileURLToPath(import.meta.url));
            const schemaPath = path.join(currentDir, 'schema.sql');
            let schemaSql = '';

            if (fs.existsSync(schemaPath)) {
                schemaSql = fs.readFileSync(schemaPath, 'utf8');
            } else {
                // Fallback path in dist/or src/
                const altPath = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
                if (fs.existsSync(altPath)) {
                    schemaSql = fs.readFileSync(altPath, 'utf8');
                } else {
                    throw new Error(`Schema file not found at ${schemaPath} or ${altPath}`);
                }
            }

            await client.query(schemaSql);
            // Keep the local node credentials aligned with the agent on every startup.
            await client.query(`
                INSERT INTO nodes (id, name, host, port, api_token)
                VALUES ($1, 'Local Master Node', $2, $3, $4)
                ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host,
                    port = EXCLUDED.port, api_token = EXCLUDED.api_token
            `, [config.agent.nodeId, config.agent.host === '0.0.0.0' ? '127.0.0.1' : config.agent.host,
                config.agent.port, config.agent.apiToken]);
            logger.info('PostgreSQL schema initialized successfully.');
        } finally {
            client.release();
        }
    } catch (err: any) {
        logger.error(`Database initialization error: ${err.message}`);
        throw err;
    }
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
    const start = Date.now();
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
        logger.warn(`Slow query (${duration}ms): ${text}`);
    }
    return res;
}

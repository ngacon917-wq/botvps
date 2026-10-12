import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAgentServer } from '../src/agent/server.js';
import { NodeAgentClient } from '../src/agent/client.js';
import { NodeRepository } from '../src/db/repositories/nodeRepository.js';
import { config } from '../src/config/index.js';
import type { Server } from 'http';
const servers: Server[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
describe('agent connection failures', () => {
    it('rejects an unknown node instead of routing its commands to the local host', async () => {
        vi.spyOn(NodeRepository, 'getById').mockResolvedValue(null);
        await expect(NodeAgentClient.getClientForNode('missing-worker')).rejects.toThrow('not registered');
    });
    it('binds the configured address and rejects an occupied port', async () => {
        const server = await startAgentServer(0);
        servers.push(server);
        const address = server.address() as { address: string; port: number };
        expect(address.address).toBe(config.agent.host);
        await expect(startAgentServer(address.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
        const response = await fetch(`http://127.0.0.1:${address.port}/api/resources`);
        expect(response.status).toBe(401);
    });
});

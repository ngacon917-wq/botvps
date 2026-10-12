import axios, { AxiosInstance } from 'axios';
import { NodeRecord, NodeRepository } from '../db/repositories/nodeRepository.js';

export class NodeAgentClient {
    private client: AxiosInstance;
    public node: NodeRecord;

    constructor(node: NodeRecord) {
        this.node = node;
        const baseURL = `http://${node.host}:${node.port}`;
        this.client = axios.create({
            baseURL,
            timeout: 120000,
            headers: {
                Authorization: `Bearer ${node.api_token}`,
                'Content-Type': 'application/json',
            },
        });
    }

    static async getClientForNode(nodeId: string): Promise<NodeAgentClient> {
        const node = await NodeRepository.getById(nodeId);
        if (!node) throw new Error(`Node "${nodeId}" is not registered.`);
        return new NodeAgentClient(node);
    }

    async checkCompatibility() {
        const { data } = await this.client.get('/api/compatibility');
        return data;
    }

    async getResources() {
        const { data } = await this.client.get('/api/resources');
        return data;
    }

    async createVps(params: {
        id: string;
        distro: string;
        release: string;
        arch?: string;
        ramMb: number;
        cpuCores: number;
        diskGb: number;
        ipAddress: string;
    }) {
        const { data } = await this.client.post('/api/vps/create', params, { timeout: 600000 });
        return data;
    }

    async startVps(id: string) {
        const { data } = await this.client.post(`/api/vps/${id}/start`);
        return data;
    }

    async stopVps(id: string) {
        const { data } = await this.client.post(`/api/vps/${id}/stop`);
        return data;
    }

    async restartVps(id: string) {
        const { data } = await this.client.post(`/api/vps/${id}/restart`);
        return data;
    }

    async reinstallVps(id: string, params: {
        distro: string;
        release: string;
        arch?: string;
        ramMb: number;
        cpuCores: number;
        diskGb: number;
        ipAddress: string;
    }) {
        const { data } = await this.client.post(`/api/vps/${id}/reinstall`, params, { timeout: 600000 });
        return data;
    }

    async deleteVps(id: string) {
        const { data } = await this.client.delete(`/api/vps/${id}`);
        return data;
    }

    async getStats(id: string) {
        const { data } = await this.client.get(`/api/vps/${id}/stats`);
        return data;
    }

    async getLogs(id: string, lines: number = 50) {
        const { data } = await this.client.get(`/api/vps/${id}/logs?lines=${lines}`);
        return data;
    }

    async exec(id: string, command: string, args: string[] = []) {
        const { data } = await this.client.post(`/api/vps/${id}/exec`, { command, args });
        return data;
    }

    async createSshxSession(id: string, userId: string) {
        const { data } = await this.client.post(`/api/vps/${id}/sshx/create`, { userId }, { timeout: 300000 });
        return data;
    }

    async stopSshxSession(id: string) {
        const { data } = await this.client.post(`/api/vps/${id}/sshx/stop`);
        return data;
    }

    async getSshxStatus(id: string) {
        const { data } = await this.client.get(`/api/vps/${id}/sshx/status`);
        return data;
    }

    async resizeVps(id: string, ramMb: number, cpuCores: number) {
        const { data } = await this.client.post(`/api/vps/${id}/resize`, { ramMb, cpuCores });
        return data;
    }

    async getDns(id: string) {
        const { data } = await this.client.get(`/api/vps/${id}/network/dns`);
        return data;
    }

    async setDns(id: string, resolvers: string[]) {
        const { data } = await this.client.post(`/api/vps/${id}/network/setdns`, { resolvers });
        return data;
    }

    async ping(id: string, host: string) {
        const { data } = await this.client.post(`/api/vps/${id}/network/ping`, { host });
        return data;
    }

    async addPortForward(id: string, ipAddress: string, publicPort: number, privatePort: number, protocol: 'tcp' | 'udp' = 'tcp') {
        const { data } = await this.client.post(`/api/vps/${id}/network/portadd`, {
            ipAddress,
            publicPort,
            privatePort,
            protocol,
        });
        return data;
    }

    async removePortForward(id: string, ipAddress: string, publicPort: number, privatePort: number, protocol: 'tcp' | 'udp' = 'tcp') {
        const { data } = await this.client.post(`/api/vps/${id}/network/portremove`, {
            ipAddress,
            publicPort,
            privatePort,
            protocol,
        });
        return data;
    }

    async createBackup(id: string) {
        const { data } = await this.client.post(`/api/vps/${id}/backup`, undefined, { timeout: 600000 });
        return data;
    }

    async deleteBackup(backupId: string) {
        const { data } = await this.client.delete(`/api/backups/${encodeURIComponent(backupId)}`);
        return data;
    }

    async restoreBackup(id: string, backupId: string) {
        const { data } = await this.client.post(`/api/vps/${id}/restore`, { backupId }, { timeout: 600000 });
        return data;
    }
}

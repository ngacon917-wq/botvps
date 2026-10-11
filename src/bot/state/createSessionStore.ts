export interface PendingCreateSession {
    token: string;
    ramMb: number;
    cpuCores: number;
    diskGb: number;
    targetUserId: string;
    creatorUserId: string;
    selectedOsId?: string;
    createdAt: number;
}

export class CreateSessionStore {
    private static sessions = new Map<string, PendingCreateSession>();

    static createSession(data: Omit<PendingCreateSession, 'token' | 'createdAt'>): string {
        const token = `create-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        this.sessions.set(token, {
            ...data,
            token,
            createdAt: Date.now(),
        });

        // Auto expire after 10 minutes
        setTimeout(() => {
            this.sessions.delete(token);
        }, 10 * 60 * 1000);

        return token;
    }

    static getSession(token: string): PendingCreateSession | undefined {
        return this.sessions.get(token);
    }

    static updateOs(token: string, osId: string): boolean {
        const s = this.sessions.get(token);
        if (!s) return false;
        s.selectedOsId = osId;
        return true;
    }

    static removeSession(token: string): void {
        this.sessions.delete(token);
    }
}

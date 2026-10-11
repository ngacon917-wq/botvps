import { describe, it, expect } from 'vitest';
import { AiDiagnosticAgent } from '../src/core/ai/diagnostics.js';
import { LxcManager } from '../src/core/lxc/lxcManager.js';

describe('AI Diagnostic & Self-Healing Agent', () => {
    it('should diagnose a non-existent container accurately', async () => {
        const lxcManager = new LxcManager();
        const report = await AiDiagnosticAgent.diagnoseContainer('vps-non-existent-9999', lxcManager);

        expect(report).toBeDefined();
        expect(report.healthy).toBe(false);
        expect(report.issuesFound.length).toBeGreaterThan(0);
        expect(report.recommendedActions.length).toBeGreaterThan(0);
    });
});

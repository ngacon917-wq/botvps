import { describe, it, expect } from 'vitest';
import { HostChecker } from '../src/core/compatibility/hostChecker.js';

describe('Host Compatibility Checker', () => {
    it('should generate a comprehensive diagnostics report', async () => {
        const report = await HostChecker.checkHost('lxcbr0', '/tmp');
        expect(report).toBeDefined();
        expect(typeof report.virtualization).toBe('string');
        expect(typeof report.compatible).toBe('boolean');
        expect(typeof report.isNestedLxc).toBe('boolean');
        expect(typeof report.hasCgroupV2).toBe('boolean');
        expect(Array.isArray(report.issues)).toBe(true);
        expect(Array.isArray(report.recommendations)).toBe(true);
    });
});

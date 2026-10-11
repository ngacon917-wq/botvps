import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { startAgentServer } from './agent/server.js';
import { HostChecker } from './core/compatibility/hostChecker.js';

async function runAgent() {
    logger.info('==============================================');
    logger.info('   VPS NODE AGENT DAEMON (STANDALONE)         ');
    logger.info(`   Node ID: ${config.agent.nodeId}            `);
    logger.info('==============================================');

    // Run host compatibility audit on startup
    const report = await HostChecker.checkHost(config.agent.bridgeInterface, config.agent.lxcPath);
    logger.info(`Host Virtualization: ${report.virtualization}`);
    logger.info(`LXC Compatibility: ${report.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE / RESTRICTED'}`);
    if (report.issues.length) {
        logger.warn(`Host Issues detected:\n${report.issues.map((i) => ` - ${i}`).join('\n')}`);
    }

    startAgentServer(config.agent.port);
}

runAgent().catch((err) => {
    logger.error(`Node Agent startup error: ${err.message}`, { stack: err.stack });
    process.exit(1);
});

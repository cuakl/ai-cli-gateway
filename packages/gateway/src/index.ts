import { logger } from '@aidev/adapters';
import { startServer } from './app.js';

async function main(): Promise<void> {
  const app = await startServer();
  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    logger.info(`received ${signal}, closing`);
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

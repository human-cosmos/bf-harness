import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";
import { BugfixService } from "./services/bugfix-service.js";
import { EventBus } from "./services/event-bus.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const service = new BugfixService({
    db,
    worktreeRoot: config.worktreeRoot,
    reposRoot: config.reposRoot,
    eventBus: new EventBus(),
    codexBin: config.codexBin,
    analysisTimeoutMs: config.analysisTimeoutMs,
    implementationTimeoutMs: config.implementationTimeoutMs,
    analysisMaxTimeoutMs: config.analysisMaxTimeoutMs,
    implementationMaxTimeoutMs: config.implementationMaxTimeoutMs,
  });

  const app = await buildApp(service);

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Bugfix Harness server listening on http://${config.host}:${config.port}`,
  );

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      service.shutdown();
      db.close();
    } catch (error) {
      console.error("Error during shutdown", error);
      process.exitCode = 1;
    } finally {
      process.exit();
    }
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

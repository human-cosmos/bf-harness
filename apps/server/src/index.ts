import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";
import { BugfixService } from "./services/bugfix-service.js";
import { EventBus } from "./services/event-bus.js";

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

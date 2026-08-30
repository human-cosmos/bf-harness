import {
  DEFAULT_SYSTEM_SETTINGS,
  systemSettingsSchema,
  type SystemSettings,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { SystemSettingsRepository } from "../repositories/system-settings-repository.js";

function positiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function defaultSystemSettingsFromEnv(): SystemSettings {
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    agent: {
      ...DEFAULT_SYSTEM_SETTINGS.agent,
      analysisIdleTimeoutMs: positiveNumber(
        process.env.BUGFIX_HARNESS_ANALYSIS_TIMEOUT_MS,
        DEFAULT_SYSTEM_SETTINGS.agent.analysisIdleTimeoutMs,
      ),
      implementationIdleTimeoutMs: positiveNumber(
        process.env.BUGFIX_HARNESS_IMPLEMENTATION_TIMEOUT_MS,
        DEFAULT_SYSTEM_SETTINGS.agent.implementationIdleTimeoutMs,
      ),
      analysisMaxDurationMs: optionalPositiveNumber(
        process.env.BUGFIX_HARNESS_ANALYSIS_MAX_DURATION_MS,
      ),
      implementationMaxDurationMs: optionalPositiveNumber(
        process.env.BUGFIX_HARNESS_IMPLEMENTATION_MAX_DURATION_MS,
      ),
      conversationIdleTimeoutMs: positiveNumber(
        process.env.BUGFIX_HARNESS_CONVERSATION_TIMEOUT_MS,
        DEFAULT_SYSTEM_SETTINGS.agent.conversationIdleTimeoutMs,
      ),
      approvalTtlMs: optionalPositiveNumber(
        process.env.BUGFIX_HARNESS_APPROVAL_TTL_MS,
      ),
    },
  };
}

export class SystemSettingsService {
  readonly repository: SystemSettingsRepository;

  constructor(
    db: AppDatabase,
    private readonly defaults = defaultSystemSettingsFromEnv(),
  ) {
    this.repository = new SystemSettingsRepository(db);
  }

  getDefaults(): SystemSettings {
    return structuredClone(this.defaults);
  }

  get(): SystemSettings {
    return this.repository.get() ?? this.getDefaults();
  }

  save(input: unknown): SystemSettings {
    const parsed = systemSettingsSchema.parse(input);
    this.repository.save(parsed);
    return parsed;
  }

  reset(): SystemSettings {
    this.repository.reset();
    return this.getDefaults();
  }
}

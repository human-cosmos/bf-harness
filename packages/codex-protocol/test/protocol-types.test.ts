import { describe, expect, it } from "vitest";
import type {
  ClientRequest,
  ServerNotification,
  ThreadStartParams,
  TurnStartParams,
} from "../src/index.js";

describe("generated Codex protocol types", () => {
  it("exports the core client and server types", () => {
    const _request = null as unknown as ClientRequest;
    const _notification = null as unknown as ServerNotification;
    const _threadStart = null as unknown as ThreadStartParams;
    const _turnStart = null as unknown as TurnStartParams;

    expect(_request).toBeNull();
    expect(_notification).toBeNull();
    expect(_threadStart).toBeNull();
    expect(_turnStart).toBeNull();
  });
});

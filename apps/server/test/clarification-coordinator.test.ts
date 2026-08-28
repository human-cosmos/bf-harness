import { describe, expect, it, vi } from "vitest";
import { ClarificationCoordinator } from "../src/services/clarification-coordinator.js";
import { EventBus } from "../src/services/event-bus.js";

describe("ClarificationCoordinator", () => {
  it("publishes a request and resolves when the user answers", async () => {
    const events = new EventBus();
    const listener = vi.fn();
    events.subscribe(listener);
    const coordinator = new ClarificationCoordinator(events);

    const answerPromise = coordinator.request({
      taskId: "task-1",
      requestId: 42,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      questions: [
        {
          id: "q1",
          header: "复现步骤",
          question: "请提供复现步骤",
          isOther: false,
          isSecret: false,
          options: null,
        },
      ],
    });

    expect(coordinator.get("task-1")?.requestId).toBe(42);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "clarification.requested", taskId: "task-1" }),
    );

    expect(
      coordinator.answer("task-1", { q1: { answers: ["点击登录按钮"] } }),
    ).toBe(true);
    expect(coordinator.get("task-1")).toBeNull();

    await expect(answerPromise).resolves.toEqual({
      q1: { answers: ["点击登录按钮"] },
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "clarification.answered", taskId: "task-1" }),
    );
  });

  it("keeps multiple pending requests for the same task separate", async () => {
    const coordinator = new ClarificationCoordinator(new EventBus());

    const first = coordinator.request({
      taskId: "task-1",
      requestId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      questions: [],
    });
    const second = coordinator.request({
      taskId: "task-1",
      requestId: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      questions: [],
    });

    expect(coordinator.get("task-1")?.requestId).toBe(1);
    expect(coordinator.answer("task-1", {})).toBe(true);
    expect(coordinator.get("task-1")?.requestId).toBe(2);
    expect(coordinator.answer("task-1", {})).toBe(true);
    expect(coordinator.get("task-1")).toBeNull();

    await expect(first).resolves.toEqual({});
    await expect(second).resolves.toEqual({});
  });

  it("resolves pending requests when the task is cleared", async () => {
    const coordinator = new ClarificationCoordinator(new EventBus());
    const pending = coordinator.request({
      taskId: "task-1",
      requestId: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      questions: [],
    });

    coordinator.clear("task-1");
    await expect(pending).resolves.toEqual({});
    expect(coordinator.get("task-1")).toBeNull();
  });
});

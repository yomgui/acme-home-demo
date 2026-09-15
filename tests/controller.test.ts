import assert from "node:assert/strict";
import { test } from "node:test";
import { WidgetController, type Clock } from "../src/controller.ts";
import { createSyntheticProvider } from "../server/provider.ts";
import type { ToolResult } from "../shared/contract.ts";

function fakeClock() {
  let tick: (() => void) | undefined;
  let milliseconds = 0;
  const timers: Clock = {
    every: (callback, ms) => {
      tick = callback;
      milliseconds = ms;
      return () => {
        tick = undefined;
      };
    },
  };
  return {
    timers,
    tick: () => tick?.(),
    running: () => Boolean(tick),
    interval: () => milliseconds,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("manual refresh calls exactly its tool and reports actual generations", async () => {
  const provider = createSyntheticProvider(
    () => new Date("2026-09-15T12:00:00Z"),
  );
  const calls: string[] = [];
  const controller = new WidgetController("today", async (name) => {
    calls.push(name);
    return { structuredContent: await provider("today") };
  });
  controller.setAvailable(true);
  await controller.refresh();
  assert.equal(controller.getSnapshot().data?.generation, 1);
  await controller.refresh();
  assert.deepEqual(calls, ["acme_today", "acme_today"]);
  assert.equal(controller.getSnapshot().data?.generation, 2);
  assert.equal(
    controller.getSnapshot().data?.generatedAt,
    "2026-09-15T12:00:00.000Z",
  );
  assert.equal(controller.getSnapshot().successes, 2);
  assert.equal(controller.getSnapshot().polling, false);
});

test("failure retains previous data, pauses polling and permits manual recovery", async () => {
  const provider = createSyntheticProvider();
  let fail = false;
  const clock = fakeClock();
  const controller = new WidgetController(
    "attention",
    async () =>
      fail
        ? { isError: true }
        : { structuredContent: await provider("attention") },
    clock.timers,
  );
  controller.setAvailable(true);
  await controller.refresh();
  const previous = controller.getSnapshot().data;
  controller.setPolling(true);
  fail = true;
  await controller.refresh();
  assert.equal(controller.getSnapshot().data, previous);
  assert.match(controller.getSnapshot().error ?? "", /denied/);
  assert.equal(clock.running(), false);
  assert.equal(controller.getSnapshot().successes, 1);
  fail = false;
  await controller.refresh();
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().data?.generation, 2);
});

test("polling is opt-in at 60 seconds and never overlaps an in-flight request", async () => {
  const clock = fakeClock();
  let calls = 0;
  const pending = deferred<ToolResult>();
  const controller = new WidgetController(
    "goals",
    async () => {
      calls++;
      return pending.promise;
    },
    clock.timers,
  );
  controller.setAvailable(true);
  assert.equal(clock.running(), false);
  controller.setPolling(true);
  assert.equal(clock.interval(), 60_000);
  clock.tick();
  clock.tick();
  await controller.refresh();
  assert.equal(calls, 1);
  pending.resolve({
    structuredContent: await createSyntheticProvider()("goals"),
  });
  await flush();
  clock.tick();
  await flush();
  assert.equal(calls, 2);
  controller.setPolling(false);
  assert.equal(clock.running(), false);
});

test("teardown aborts in-flight work, clears polling and ignores late responses", async () => {
  const clock = fakeClock();
  const pending = deferred<ToolResult>();
  let signal: AbortSignal | undefined;
  const controller = new WidgetController(
    "today",
    async (_name, abort) => {
      signal = abort;
      return pending.promise;
    },
    clock.timers,
  );
  controller.setAvailable(true);
  controller.setPolling(true);
  const request = controller.refresh();
  controller.stop();
  assert.equal(signal?.aborted, true);
  assert.equal(clock.running(), false);
  pending.resolve({
    structuredContent: await createSyntheticProvider()("today"),
  });
  await request;
  assert.equal(controller.getSnapshot().data, null);
  assert.equal(await controller.refresh(), false);
});

test("capability denial prevents calls and revocation preserves previous data", async () => {
  let calls = 0;
  const clock = fakeClock();
  const provider = createSyntheticProvider();
  const controller = new WidgetController(
    "goals",
    async () => {
      calls++;
      return { structuredContent: await provider("goals") };
    },
    clock.timers,
  );
  controller.setAvailable(false);
  controller.setPolling(true);
  assert.equal(await controller.refresh(), false);
  assert.equal(calls, 0);
  assert.equal(clock.running(), false);
  controller.setAvailable(true);
  await controller.refresh();
  const previous = controller.getSnapshot().data;
  controller.setPolling(true);
  controller.setAvailable(false);
  assert.equal(clock.running(), false);
  assert.equal(controller.getSnapshot().data, previous);
  assert.match(controller.getSnapshot().error ?? "", /Host does not allow/);
});

test("panel request, error and polling states are independent", async () => {
  const provider = createSyntheticProvider();
  const blocked = deferred<ToolResult>();
  const today = new WidgetController("today", () => blocked.promise);
  const attention = new WidgetController("attention", async () => {
    throw new Error("attention unavailable");
  });
  const goals = new WidgetController("goals", async () => ({
    structuredContent: await provider("goals"),
  }));
  for (const controller of [today, attention, goals])
    controller.setAvailable(true);
  const pending = today.refresh();
  await Promise.all([attention.refresh(), goals.refresh()]);
  assert.equal(today.getSnapshot().busy, true);
  assert.match(attention.getSnapshot().error ?? "", /attention unavailable/);
  assert.equal(goals.getSnapshot().data?.kind, "goals");
  assert.equal(goals.getSnapshot().error, null);
  blocked.resolve({ structuredContent: await provider("today") });
  await pending;
});

test("malformed, wrong-panel and stale responses cannot replace previous data", async () => {
  const provider = createSyntheticProvider();
  const controller = new WidgetController("today", async () => ({}));
  controller.setAvailable(true);
  const first = await provider("today");
  const second = await provider("today");
  controller.receive({ structuredContent: second });
  for (const structuredContent of [
    null,
    { kind: "today" },
    await provider("goals"),
    first,
    { ...second, generatedAt: "not-a-date" },
  ]) {
    controller.receive({ structuredContent });
    assert.deepEqual(controller.getSnapshot().data, second);
    assert.ok(controller.getSnapshot().error);
  }
});

test("newer server instance is accepted without inventing business changes", async () => {
  const earlier = await createSyntheticProvider(
    () => new Date("2026-09-15T12:00:00Z"),
  )("goals");
  const later = await createSyntheticProvider(
    () => new Date("2026-09-15T12:01:00Z"),
  )("goals");
  const controller = new WidgetController("goals", async () => ({}));
  controller.setAvailable(true);
  controller.receive({ structuredContent: earlier });
  controller.receive({ structuredContent: later });
  assert.deepEqual(controller.getSnapshot().data, later);
  assert.equal(later.kind === "goals" && later.overall, 72);
  assert.equal(later.generation, 1);
  assert.notEqual(earlier.providerInstance, later.providerInstance);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard, greeting } from "../src/ui.tsx";
import { WidgetController } from "../src/controller.ts";
import { createSyntheticProvider } from "../server/provider.ts";
import { widgetIds } from "../shared/contract.ts";

test("greeting respects viewer timezone without a hardcoded employee identity", () => {
  const now = new Date("2026-09-14T10:00:00Z");
  assert.equal(greeting("UTC", undefined, now), "Good morning!");
  assert.equal(greeting("Asia/Kolkata", undefined, now), "Good afternoon!");
  assert.equal(greeting("Asia/Tokyo", undefined, now), "Good evening!");
  assert.equal(greeting("UTC", "  ", now), "Good morning!");
  assert.equal(
    greeting("UTC", "Demo viewer", now),
    "Good morning, Demo viewer!",
  );
  assert.equal(
    greeting("invalid/timezone", undefined, now),
    greeting(undefined, undefined, now),
  );
});

test("shared home renders an anonymous greeting and never bakes a viewer name into public HTML", async (t) => {
  const previous = process.env.DEMO_VIEWER_NAME;
  process.env.DEMO_VIEWER_NAME = "Unverified Viewer";
  t.after(() => {
    if (previous === undefined) delete process.env.DEMO_VIEWER_NAME;
    else process.env.DEMO_VIEWER_NAME = previous;
  });
  const provider = createSyntheticProvider();
  const controllers = {
    today: new WidgetController("today", async () => ({})),
    attention: new WidgetController("attention", async () => ({})),
    goals: new WidgetController("goals", async () => ({})),
  };
  for (const widget of widgetIds) {
    controllers[widget].receive({ structuredContent: await provider(widget) });
    t.after(() => controllers[widget].stop());
  }
  const html = renderToStaticMarkup(
    createElement(Dashboard, { controllers, view: "home", timeZone: "UTC" }),
  );
  assert.match(html, /Good (morning|afternoon|evening)!/);
  assert.ok(html.includes("Shared demo"));
  assert.ok(html.includes("no connected identity"));
  assert.ok(!html.includes("Unverified Viewer"));
  assert.ok(!html.includes("Connect to personalize"));
  for (const path of ["src/ui.tsx", "src/main.tsx", "scripts/build.ts"]) {
    const source = await readFile(
      new URL(`../${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /DEMO_VIEWER_NAME/);
  }
});

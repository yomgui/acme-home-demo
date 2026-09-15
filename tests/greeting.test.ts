import assert from "node:assert/strict";
import test from "node:test";
import { greeting } from "../src/ui.tsx";

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

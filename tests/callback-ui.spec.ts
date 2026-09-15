import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { createHandler } from "../server/handler.ts";

test("expired callback renders a clean page on first load and reuse without automatic retries", async ({
  page,
}) => {
  const privateKeyPem = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const handler = createHandler({
    issuer: "https://callback-ui.example.test",
    privateKeyPem,
    identityMode: "openwork",
    upstreamOptions: { env: {}, diagnostics: () => {} },
  });
  let callbacks = 0;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/oauth/upstream/callback")) callbacks++;
    void handler(req, res);
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test listener");
    const response = await page.goto(
      `http://127.0.0.1:${address.port}/oauth/upstream/callback?state=expired-fixture&code=fixture`,
    );
    expect(response?.status()).toBe(400);
    await expect(
      page.getByRole("heading", { name: "Sign-in expired, try again" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("expired-fixture");
    await expect(page.locator("body")).not.toContainText("invalid_grant");
    await expect(page.locator("script, form, input, iframe")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(callbacks).toBe(1);
    expect((await page.reload())?.status()).toBe(400);
    await expect(
      page.getByRole("heading", { name: "Sign-in expired, try again" }),
    ).toBeVisible();
    expect(callbacks).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { test, expect } from "@playwright/test";

test("home renders through the SDK resource bridge, retains layout and refreshes only the selected panel", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4329"))
      external.push(request.url());
  });
  await page.goto("/");
  const app = page.frameLocator("iframe");
  await expect(app.locator(".brand")).toHaveText("Acme Home");
  await expect(app.getByRole("heading", { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening)!$/,
  );
  await expect(app.locator(".widget")).toHaveCount(3);
  await expect(app.locator(".receipt strong")).toHaveText(["1", "1", "1"]);
  await expect(app.locator(".rail")).toHaveCSS(
    "background-color",
    "rgb(17, 29, 54)",
  );
  await expect(app.locator(".rail")).toHaveCSS("width", "195px");
  await expect(app.locator(".right-column")).toHaveCSS("width", "300px");
  await expect(app.locator(".category")).toHaveCount(5);
  const geometry = await app
    .locator(".workspace-columns")
    .evaluate((element) => {
      const main = element
        .querySelector(".home-content")
        ?.getBoundingClientRect();
      const aside = element
        .querySelector(".right-column")
        ?.getBoundingClientRect();
      return {
        gap: main && aside ? aside.x - main.right : null,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  expect(geometry).toEqual({ gap: 24, overflow: false });
  await page.screenshot({
    path: info.outputPath("acme-home-desktop.png"),
    fullPage: true,
  });
  const today = app.getByRole("region", { name: "Today at a Glance" });
  const attention = app.getByRole("region", { name: "Needs Your Attention" });
  const goals = app.getByRole("region", { name: "My Goals", exact: true });
  const before = await page.locator("#calls").textContent();
  expect(JSON.parse(before ?? "[]")).toEqual([
    { name: "acme_home", arguments: { widget: "today" } },
    { name: "acme_home", arguments: { widget: "attention" } },
    { name: "acme_home", arguments: { widget: "goals" } },
  ]);
  await today.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(today.locator(".receipt strong")).toHaveText("2");
  await expect(attention.locator(".receipt strong")).toHaveText("1");
  await expect(goals.locator(".receipt strong")).toHaveText("1");
  await attention
    .getByRole("button", { name: "Critical", exact: true })
    .click();
  await expect(attention.locator(".attention-item")).toHaveCount(1);
  await attention.locator("summary").click();
  await expect(attention.getByText(/ACME-1042/)).toBeVisible();
  await page.getByRole("button", { name: "Fail next attention call" }).click();
  await attention.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(attention.getByRole("alert")).toContainText(
    "Previous data retained",
  );
  await expect(attention.locator(".receipt strong")).toHaveText("1");
  await attention.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(attention.locator(".receipt strong")).toHaveText("2");
  await expect(attention.getByRole("alert")).toHaveCount(0);
  const callsBeforePreview = await page.locator("#calls").textContent();
  await app.getByRole("button", { name: "Help me plan my day" }).click();
  await app.getByRole("button", { name: "Preview response" }).click();
  await expect(app.getByRole("dialog")).toContainText("Nothing was sent");
  await app.getByRole("button", { name: "Close preview" }).click();
  await app.getByRole("button", { name: "Customize", exact: true }).click();
  await app.getByLabel("Payroll illustration").uncheck();
  await app.getByRole("button", { name: "Close preview" }).click();
  await expect(app.locator(".static-tile")).toHaveCount(2);
  await app
    .getByRole("textbox", { name: "Search demo categories" })
    .fill("benefits");
  await expect(app.locator(".category")).toHaveCount(1);
  await expect(page.locator("#calls")).toHaveText(callsBeforePreview ?? "");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.getByRole("button", { name: "Host teardown" }).click();
  await expect(app.locator("#root")).toBeEmpty();
});

test("denied host capabilities leave home readable with refresh and polling disabled", async ({
  page,
}) => {
  await page.goto("/?deny=1");
  const app = page.frameLocator("iframe");
  await expect(app.locator(".widget")).toHaveCount(3);
  for (const button of await app
    .getByRole("button", { name: "Refresh", exact: true })
    .all())
    await expect(button).toBeDisabled();
  for (const checkbox of await app.getByRole("checkbox").all())
    await expect(checkbox).toBeDisabled();
  await expect(app.getByRole("alert")).toHaveCount(3);
  await expect(page.locator("#calls")).toBeEmpty();
});

test("mobile home keeps all panels within the viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const app = page.frameLocator("iframe");
  await expect(app.locator(".receipt strong")).toHaveCount(3);
  await expect(app.locator(".rail")).toBeHidden();
  const sizes = await app.locator(".shell").evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.width);
  await page.screenshot({
    path: info.outputPath("acme-home-mobile.png"),
    fullPage: true,
  });
});

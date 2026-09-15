import { test, expect, type Page } from "@playwright/test";

function shellCalls(...widgets: string[]) {
  return JSON.stringify(
    widgets.map((widget) => ({
      name: "acme_home",
      arguments: { widget },
    })),
  );
}

async function load(page: Page, query = "") {
  await page.goto(`/${query}`);
  const app = page.frameLocator("iframe");
  await expect(
    app
      .getByRole("heading", {
        name: query.includes("view=")
          ? /Today at a Glance|Needs Your Attention|My Goals/
          : /^Good (morning|afternoon|evening)!$/,
      })
      .first(),
  ).toBeVisible();
  return app;
}

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
  await expect(app.getByTestId("viewer-identity")).toHaveText("Shared demo");
  await expect(app.locator(".demo-banner")).toContainText(
    "no connected identity",
  );
  await expect(
    app.getByRole("button", { name: "AI Chat", exact: true }),
  ).toBeDisabled();
  for (const title of [
    "Today at a Glance",
    "Needs Your Attention",
    "My Goals",
  ]) {
    const widget = app.getByRole("region", { name: title, exact: true });
    await expect(widget.getByRole("status")).toContainText("1 accepted result");
    await expect(widget.getByRole("checkbox")).not.toBeChecked();
  }
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
  await app.getByRole("button", { name: /Finance & Expenses/ }).click();
  await expect(app.getByRole("dialog")).toContainText(
    "No payroll or payment system is connected",
  );
  await app.getByRole("button", { name: "Close preview" }).click();
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
  for (const title of [
    "Today at a Glance",
    "Needs Your Attention",
    "My Goals",
  ]) {
    const widget = app.getByRole("region", { name: title, exact: true });
    await expect(widget.getByRole("status")).toContainText("1 accepted result");
    const refresh = widget.getByRole("button", {
      name: "Refresh",
      exact: true,
    });
    await refresh.scrollIntoViewIfNeeded();
    await expect(refresh).toBeInViewport();
  }
  await page.screenshot({
    path: info.outputPath("acme-home-mobile.png"),
    fullPage: true,
  });
});

test("manual refresh affects one widget, advances its generation and preserves details", async ({
  page,
}) => {
  const app = await load(page);
  const today = app.getByRole("region", {
    name: "Today at a Glance",
    exact: true,
  });
  const attention = app.getByRole("region", {
    name: "Needs Your Attention",
    exact: true,
  });
  await expect(today.getByRole("status")).toContainText("1 accepted result");
  await expect(attention.getByRole("status")).toContainText(
    "1 accepted result",
  );
  const otherReceipt = await attention.getByRole("status").innerText();
  const generation = Number(await today.locator(".receipt strong").innerText());
  await today.getByText("Architecture Review", { exact: true }).click();
  await expect(today.getByText(/Review the platform proposal/)).toBeVisible();
  await today.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(today.getByRole("status")).toContainText("2 accepted results");
  await expect(today.locator(".receipt strong")).toHaveText(
    String(generation + 1),
  );
  await expect(page.locator("#calls")).toHaveText(
    shellCalls("today", "attention", "goals", "today"),
  );
  await expect(attention.getByRole("status")).toHaveText(otherReceipt, {
    useInnerText: true,
  });
  await expect(today.getByText(/Review the platform proposal/)).toBeVisible();
});

test("attention filters and details stay local; failed refresh retains rows and pauses only its polling", async ({
  page,
}) => {
  const app = await load(page);
  const attention = app.getByRole("region", {
    name: "Needs Your Attention",
    exact: true,
  });
  const goals = app.getByRole("region", { name: "My Goals", exact: true });
  await expect(attention.getByRole("status")).toContainText(
    "1 accepted result",
  );
  await expect(goals.getByRole("status")).toContainText("1 accepted result");
  const generation = await attention.locator(".receipt strong").innerText();
  const initialCalls = await page.locator("#calls").innerText();
  await attention
    .getByRole("button", { name: "Critical", exact: true })
    .click();
  await expect(
    attention.getByText("Payroll Declaration", { exact: true }),
  ).toHaveCount(0);
  await attention.getByText("P1 Incident Assigned", { exact: true }).click();
  await expect(
    attention.getByText(/Synthetic incident ACME-1042/),
  ).toBeVisible();
  await expect(page.locator("#calls")).toHaveText(initialCalls);
  await attention.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Fail next attention call" }).click();
  await attention.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(attention.getByRole("alert")).toContainText("Polling paused");
  await expect(attention.locator(".receipt strong")).toHaveText(generation);
  await expect(
    attention.getByText("P1 Incident Assigned", { exact: true }),
  ).toBeVisible();
  await expect(attention.getByRole("checkbox")).not.toBeChecked();
  await expect(goals.getByRole("alert")).toHaveCount(0);
  await attention.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(attention.getByRole("alert")).toHaveCount(0);
  await expect(attention.getByRole("status")).toContainText(
    "2 accepted results",
  );
  await expect(
    attention.getByText(/Synthetic incident ACME-1042/),
  ).toBeVisible();
  await expect(page.locator("#calls")).toHaveText(
    shellCalls("today", "attention", "goals", "attention", "attention"),
  );
});

test("60-second polling is opt-in, isolated, and stops on toggle and host teardown", async ({
  page,
}) => {
  await page.clock.install();
  const app = await load(page);
  const today = app.getByRole("region", {
    name: "Today at a Glance",
    exact: true,
  });
  const goals = app.getByRole("region", { name: "My Goals", exact: true });
  await expect(today.getByRole("status")).toContainText("1 accepted result");
  await expect(goals.getByRole("status")).toContainText("1 accepted result");
  await page.clock.fastForward(120_000);
  await expect(today.getByRole("status")).toContainText("1 accepted result");
  await expect(page.locator("#calls")).toHaveText(
    shellCalls("today", "attention", "goals"),
  );
  await today.getByRole("checkbox").check();
  await page.clock.fastForward(59_000);
  await expect(page.locator("#calls")).toHaveText(
    shellCalls("today", "attention", "goals"),
  );
  await page.clock.fastForward(1_000);
  await expect(today.getByRole("status")).toContainText("2 accepted results");
  await expect(goals.getByRole("status")).toContainText("1 accepted result");
  await expect(page.locator("#calls")).toHaveText(
    shellCalls("today", "attention", "goals", "today"),
  );
  await today.getByRole("checkbox").uncheck();
  await page.clock.fastForward(120_000);
  await expect(today.getByRole("status")).toContainText("2 accepted results");
  await today.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Host teardown" }).click();
  await expect(app.locator("#root")).toBeEmpty();
  const calls = await page.locator("#calls").innerText();
  await page.clock.fastForward(180_000);
  await expect(page.locator("#calls")).toHaveText(calls);
});

test("capability-denied standalone host keeps launch data but disables refresh and polling", async ({
  page,
}) => {
  const app = await load(page, "?view=today&deny=1");
  const today = app.getByRole("region", {
    name: "Today at a Glance",
    exact: true,
  });
  await expect(today.getByRole("status")).toContainText("1 accepted result");
  await expect(
    today.getByText("Architecture Review", { exact: true }),
  ).toBeVisible();
  await expect(
    today.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeDisabled();
  await expect(today.getByRole("checkbox")).toBeDisabled();
  await expect(today.getByRole("alert")).toContainText("Host does not allow");
  await expect(page.locator("#calls")).toBeEmpty();
});

for (const view of ["today", "attention", "goals"]) {
  test(`${view} launches as one standalone widget and reuses only its own tool`, async ({
    page,
  }) => {
    const app = await load(page, `?view=${view}`);
    await expect(app.getByRole("status")).toContainText("1 accepted result");
    await expect(app.locator(".widget")).toHaveCount(1);
    await expect(page.locator("#calls")).toBeEmpty();
    await app.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(app.getByRole("status")).toContainText("2 accepted results");
    await expect(page.locator("#calls")).toHaveText(
      JSON.stringify([{ name: `acme_${view}`, arguments: {} }]),
    );
  });
}

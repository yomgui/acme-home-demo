import { test, expect } from "@playwright/test";

const widgets = ["today", "attention", "goals"];
test("per-user SDK bridge fixtures render distinct identities and all sets; Refresh stays panel-local", async ({
  page,
  context,
}) => {
  await page.goto("/?member=a");
  const app = page.frameLocator("iframe");
  for (const widget of widgets)
    await expect(app.getByTestId(`${widget}-generation`)).toBeVisible();
  const firstName = await app.getByTestId("viewer-identity").innerText();
  await expect(app.getByTestId("viewer-greeting")).toHaveText(
    /^Good (morning|afternoon|evening), [A-Za-z]+!$/,
  );
  const other = await context.newPage();
  await other.goto("/?member=b");
  const second = other.frameLocator("iframe");
  for (const widget of widgets)
    await expect(second.getByTestId(`${widget}-generation`)).toBeVisible();
  expect(await second.getByTestId("viewer-identity").innerText()).not.toEqual(
    firstName,
  );
  for (const widget of widgets) {
    const selected = app.getByTestId(`${widget}-set`);
    const before = await selected.locator("summary").allTextContents();
    expect(
      await second
        .getByTestId(`${widget}-set`)
        .locator("summary")
        .allTextContents(),
    ).not.toEqual(before);
    const generations = await Promise.all(
      widgets.map((id) => app.getByTestId(`${id}-generation`).innerText()),
    );
    await selected
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await expect(app.getByTestId(`${widget}-generation`)).toHaveText(
      String(Number(generations[widgets.indexOf(widget)]) + 1),
    );
    expect(await selected.locator("summary").allTextContents()).not.toEqual(
      before,
    );
    for (const id of widgets.filter((id) => id !== widget))
      await expect(app.getByTestId(`${id}-generation`)).toHaveText(
        generations[widgets.indexOf(id)]!,
      );
    await expect(app.getByTestId(`${widget}-identity`)).toContainText(
      firstName,
    );
    await expect(app.getByTestId(`${widget}-generated-at`)).toHaveAttribute(
      "datetime",
      /^\d{4}-\d\d-\d\dT/,
    );
  }
  await other.close();
  await page.getByRole("button", { name: "Expire demo identity" }).click();
  await app
    .getByTestId("today-set")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(app.getByTestId("viewer-identity")).toHaveText(
    "Connect to personalize",
  );
  await expect(app.getByTestId("viewer-greeting")).toHaveText(
    /^Good (morning|afternoon|evening)!$/,
  );
  for (const widget of widgets) {
    const panel = app.getByTestId(`${widget}-set`);
    await expect(panel.getByRole("alert")).toHaveText("Connect to personalize");
    await expect(panel.locator("summary")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
  }
  await expect(app.locator(".shell")).not.toContainText(firstName);
});

test("401 bootstrap has no spinner or wrong name; personalized mobile rows do not overflow", async ({
  page,
}) => {
  await page.goto("/?member=a&unauthorized=1");
  const app = page.frameLocator("iframe");
  await expect(app.getByTestId("viewer-identity")).toHaveText(
    "Connect to personalize",
  );
  await expect(app.getByRole("alert")).toHaveCount(3);
  await expect(app.locator(".shell")).not.toContainText(
    "Fetching synthetic data",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?member=b");
  for (const widget of widgets)
    await expect(app.getByTestId(`${widget}-generation`)).toBeAttached();
  const dimensions = await app.locator("body").evaluate((element) => ({
    scroll: element.scrollWidth,
    viewport: element.ownerDocument.documentElement.clientWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
});

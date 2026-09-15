import { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { widgetIds } from "../shared/contract.ts";
import { createSyntheticProvider, type WidgetProvider } from "./provider.ts";
import { registerHome, registerWidget, type LoadHtml } from "./register.ts";

export const loadBuiltHtml: LoadHtml = async (id) => {
  try {
    return await readFile(
      new URL(`../dist/${id}.html`, import.meta.url),
      "utf8",
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    return readFile(join(process.cwd(), "dist", `${id}.html`), "utf8");
  }
};

export function createServer(
  provider: WidgetProvider = createSyntheticProvider(),
  loadHtml: LoadHtml = loadBuiltHtml,
) {
  const server = new McpServer({ name: "acme-home-demo", version: "0.1.0" });
  for (const id of widgetIds)
    registerWidget(server, id, { provider, loadHtml });
  registerHome(server, loadHtml, provider);
  return server;
}

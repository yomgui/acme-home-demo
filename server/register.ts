import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  definitions,
  resourceUri,
  schemas,
  homeInputSchema,
  homeOutputSchema,
  type ViewId,
  type WidgetId,
} from "../shared/contract.ts";
import type { WidgetProvider } from "./provider.ts";

export type LoadHtml = (id: ViewId) => Promise<string>;

function registerView(server: McpServer, id: ViewId, loadHtml: LoadHtml) {
  const uri = resourceUri(id);
  registerAppResource(
    server,
    definitions[id].title,
    uri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadHtml(id),
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        },
      ],
    }),
  );
}

export function registerWidget(
  server: McpServer,
  id: WidgetId,
  options: { provider: WidgetProvider; loadHtml: LoadHtml },
) {
  registerAppTool(
    server,
    definitions[id].tool,
    {
      title: definitions[id].title,
      description: `Open or refresh ${definitions[id].title}. Synthetic demo data; no customer services connected.`,
      inputSchema: z.object({}).strict(),
      outputSchema: schemas[id],
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: {
        ui: { resourceUri: resourceUri(id), visibility: ["model", "app"] },
      },
    },
    async () => {
      try {
        const data = schemas[id].parse(await options.provider(id));
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Widget provider failed. Retry manually; previous data can remain visible.",
            },
          ],
        };
      }
    },
  );
  registerView(server, id, options.loadHtml);
}

export function registerHome(
  server: McpServer,
  loadHtml: LoadHtml,
  provider: WidgetProvider,
) {
  registerAppTool(
    server,
    definitions.home.tool,
    {
      title: definitions.home.title,
      description:
        "Open the synthetic Acme Home with {} (layout only, no provider call), or fetch one panel with {widget: 'today' | 'attention' | 'goals'}. All panels share this home resource/security scope; no aggregate data is returned.",
      inputSchema: homeInputSchema,
      outputSchema: homeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: {
        ui: { resourceUri: resourceUri("home"), visibility: ["model", "app"] },
      },
    },
    async ({ widget }) => {
      if (widget === undefined) {
        return {
          content: [
            {
              type: "text",
              text: "Synthetic Acme Home. Each panel fetches this same tool with its own widget selector. No provider was called for this layout-only launch.",
            },
          ],
          structuredContent: { kind: "shell", demo: true },
        };
      }
      try {
        const data = schemas[widget].parse(await provider(widget));
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Selected home provider failed. Retry this panel manually; previous data can remain visible.",
            },
          ],
        };
      }
    },
  );
  registerView(server, "home", loadHtml);
}

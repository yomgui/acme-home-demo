import type { CallToolResult, Tool } from "@modelcontextprotocol/client";

export async function resourceBoundCall(
  tools: Tool[],
  mountedResource: string,
  params: { name: string; arguments?: Record<string, unknown> },
  forward: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const ui = tools.find((tool) => tool.name === params.name)?._meta?.ui;
  if (
    !ui ||
    typeof ui !== "object" ||
    !("resourceUri" in ui) ||
    ui.resourceUri !== mountedResource
  )
    return {
      isError: true,
      content: [{ type: "text", text: "tool_resource_mismatch" }],
    };
  return forward();
}

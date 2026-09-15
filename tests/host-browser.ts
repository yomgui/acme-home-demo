import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { definitions, resourceUri, type ViewId } from "../shared/contract.ts";
import { resourceBoundCall } from "./resource-gate.ts";

const query = new URLSearchParams(location.search);
const requested = query.get("view");
const view: ViewId =
  requested === "today" || requested === "attention" || requested === "goals"
    ? requested
    : "home";
const allowCalls = query.get("deny") !== "1";
const client = new Client({ name: "acme-sdk-test-host", version: "1" });
await client.connect(
  new StreamableHTTPClientTransport(
    new URL(
      query.get("member") === "a"
        ? "/fixture-a"
        : query.get("member") === "b"
          ? "/fixture-b"
          : "/mcp",
      location.href,
    ),
  ),
);
const { tools } = await client.listTools();
const result = await client.callTool({
  name: definitions[view].tool,
  arguments: {},
});
const resource = await client.readResource({ uri: resourceUri(view) });
const html = resource.contents[0];
if (!html || !("text" in html)) throw new Error("Missing HTML resource");
const iframe = document.querySelector("iframe");
if (!iframe?.contentWindow) throw new Error("Missing frame window");
const bridge = new AppBridge(
  null,
  { name: "acme-sdk-test-host", version: "1" },
  allowCalls ? { serverTools: {} } : {},
);
const calls: { name: string; arguments: Record<string, unknown> }[] = [];
let failAttention = false;
let unauthorized = query.get("unauthorized") === "1";
document.getElementById("expire")?.addEventListener("click", () => {
  unauthorized = true;
});
document.getElementById("fail")?.addEventListener("click", () => {
  failAttention = true;
});
document.getElementById("teardown")?.addEventListener("click", () => {
  void bridge.teardownResource({});
});
bridge.oncalltool = async (params) =>
  resourceBoundCall(tools, resourceUri(view), params, async () => {
    calls.push({ name: params.name, arguments: params.arguments ?? {} });
    const counter = document.getElementById("calls");
    if (counter) counter.textContent = JSON.stringify(calls);
    if (unauthorized)
      return {
        isError: true,
        content: [{ type: "text", text: "HTTP 401: Connect to personalize" }],
      };
    if (!allowCalls)
      return {
        isError: true,
        content: [{ type: "text", text: "Host capability denied" }],
      };
    if (
      (params.name === definitions.attention.tool ||
        (params.name === definitions.home.tool &&
          params.arguments?.widget === "attention")) &&
      failAttention
    ) {
      failAttention = false;
      return {
        isError: true,
        content: [{ type: "text", text: "Injected test failure" }],
      };
    }
    return client.callTool(params);
  });
bridge.oninitialized = () => {
  void bridge.sendToolResult(result);
};
await bridge.connect(
  new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
);
iframe.srcdoc = html.text.replace(
  "<head>",
  "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';\">",
);

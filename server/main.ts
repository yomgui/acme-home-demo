import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";
import { createSyntheticProvider } from "./provider.ts";
import { createHttpApp, resolvePort } from "./http.ts";
import { resolveIdentityMode } from "./identity-mode.ts";

const provider = createSyntheticProvider();
if (process.argv.includes("--stdio")) {
  if (resolveIdentityMode() !== "shared")
    throw new Error("Stdio supports shared mode only; use HTTP for identity");
  const server = createServer(provider);
  await server.connect(new StdioServerTransport());
} else {
  if (process.env.HOST && process.env.HOST !== "127.0.0.1")
    throw new Error(
      "Only HOST=127.0.0.1 is supported; public binds are forbidden",
    );
  const port = resolvePort(process.env.PORT);
  const listener = createHttpApp(() => createServer(provider)).listen(
    port,
    "127.0.0.1",
    () => {
      console.error(
        `Synthetic Acme Home MCP server: http://127.0.0.1:${port}/mcp`,
      );
    },
  );
  const stop = () => {
    listener.close();
    listener.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

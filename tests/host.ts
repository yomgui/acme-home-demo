import { build } from "esbuild";
import { createHttpApp } from "../server/http.ts";
import { createServer } from "../server/server.ts";
import {
  createSyntheticProvider,
  createPersonalProvider,
} from "../server/provider.ts";
import { handleMcpPost } from "../server/handler.ts";

const provider = createSyntheticProvider();
const app = createHttpApp(() => createServer(provider), {
  authRequired: false,
});
for (const member of ["a", "b"]) {
  const personal = createPersonalProvider(`ui-fixture-${member}`);
  app.post(`/fixture-${member}`, (req, res) =>
    handleMcpPost(() => createServer(personal), req, res, req.body),
  );
}
const bundle = await build({
  entryPoints: ["tests/host-browser.ts"],
  bundle: true,
  write: false,
  format: "esm",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const javascript = bundle.outputFiles[0]?.text;
if (!javascript) throw new Error("Missing test host bundle");
app.get("/host.js", (_req, res) => {
  res.type("application/javascript").send(javascript);
});
app.get("/", (_req, res) => {
  res
    .type("html")
    .send(
      '<!doctype html><html><head><title>Acme Home · MCP SDK preview</title><style>body{margin:0}iframe{display:block;width:100%;height:calc(100vh - 32px);border:0}header{height:32px;font:12px sans-serif;display:flex;gap:12px;align-items:center;padding:0 12px}#calls{margin-left:auto;max-width:50%;overflow:hidden;white-space:nowrap}</style></head><body><header>Acme Home · SDK preview <button id="fail">Fail next attention call</button><button id="teardown">Host teardown</button><button id="expire">Expire demo identity</button><span id="calls"></span></header><iframe title="MCP App" sandbox="allow-scripts"></iframe><script type="module" src="/host.js"></script></body></html>',
    );
});
const listener = app.listen(4329, "127.0.0.1");
const stop = () => {
  listener.close();
  listener.closeAllConnections();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

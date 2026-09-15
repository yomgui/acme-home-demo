import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { definitions, widgetIds } from "../shared/contract.ts";

const out = new URL("../dist/", import.meta.url);
await mkdir(out, { recursive: true });
const css = await readFile(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
for (const id of [...widgetIds, "home"] as const) {
  const result = await build({
    entryPoints: ["src/main.tsx"],
    bundle: true,
    metafile: true,
    write: false,
    minify: true,
    format: "esm",
    target: "es2022",
    define: {
      VIEW_ID: JSON.stringify(id),
      "process.env.NODE_ENV": '"production"',
    },
  });
  const script = result.outputFiles[0]?.text;
  if (!script) throw new Error("Bundle missing");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${definitions[id].title}</title><style>${css}</style></head><body><div id="root"></div><script type="module">${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  if (Buffer.byteLength(html) > 768 * 1024) {
    console.error(
      Object.values(result.metafile.outputs)
        .flatMap((output) => Object.entries(output.inputs))
        .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
        .slice(0, 12),
    );
    throw new Error(
      `${id}: ${Math.round(Buffer.byteLength(html) / 1024)} KiB exceeds 768 KiB resource budget`,
    );
  }
  await writeFile(new URL(`${id}.html`, out), html);
  console.log(`${id}.html: ${Math.round(Buffer.byteLength(html) / 1024)} KiB`);
}

const functions = await build({
  entryPoints: { mcp: "./hosted/mcp.ts", healthz: "./hosted/healthz.ts" },
  outdir: "api",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  metafile: true,
  logLevel: "error",
});
for (const [file, output] of Object.entries(functions.metafile.outputs))
  console.log(`${file}: ${Math.round(output.bytes / 1024)} KiB`);

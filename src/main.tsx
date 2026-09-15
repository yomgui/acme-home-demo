import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import {
  definitions,
  widgetIds,
  type ViewId,
  type WidgetId,
} from "../shared/contract.ts";
import { WidgetController } from "./controller.ts";
import { Dashboard, type Controllers } from "./ui.tsx";

declare const VIEW_ID: ViewId;
const app = new App({ name: definitions[VIEW_ID].title, version: "0.1.0" }, {});
const makeController = (id: WidgetId) =>
  new WidgetController(id, (name, signal) =>
    app.callServerTool(
      VIEW_ID === "home"
        ? { name: definitions.home.tool, arguments: { widget: id } }
        : { name, arguments: {} },
      { signal, timeout: 20_000, maxTotalTimeout: 20_000 },
    ),
  );
const controllers: Controllers = {
  today: makeController("today"),
  attention: makeController("attention"),
  goals: makeController("goals"),
};
const active =
  VIEW_ID === "home"
    ? widgetIds.map((id) => controllers[id])
    : [controllers[VIEW_ID]];
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing app root");
const root = createRoot(rootElement);
let timeZone: string | undefined;
const render = (connectionError?: string) =>
  root.render(
    <Dashboard
      controllers={controllers}
      view={VIEW_ID}
      connectionError={connectionError}
      timeZone={timeZone}
    />,
  );
let stopped = false;
const stop = () => {
  stopped = true;
  for (const controller of active) controller.stop();
  root.unmount();
};
app.onhostcontextchanged = (context) => {
  if (!stopped && context.timeZone !== undefined) {
    timeZone = context.timeZone;
    render();
  }
};
app.ontoolresult = (result) => {
  if (VIEW_ID !== "home") controllers[VIEW_ID].receive(result);
};
app.onteardown = async () => {
  stop();
  return {};
};
app.onclose = () => {
  for (const controller of active) controller.setAvailable(false);
};
window.addEventListener("pagehide", stop, { once: true });
render();
try {
  await app.connect();
  if (!stopped) {
    timeZone = app.getHostContext()?.timeZone;
    render();
    const available = Boolean(app.getHostCapabilities()?.serverTools);
    for (const controller of active) controller.setAvailable(available);
    if (VIEW_ID === "home")
      for (const controller of active) void controller.refresh();
  }
} catch {
  if (!stopped) {
    for (const controller of active) controller.setAvailable(false);
    render(
      "MCP host connection failed. Open this ui:// resource through its registered MCP tool in a compatible host.",
    );
  }
}

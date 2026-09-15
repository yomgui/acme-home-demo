import { z } from "zod";

export const widgetIds = ["today", "attention", "goals"] as const;
export type WidgetId = (typeof widgetIds)[number];
export type ViewId = WidgetId | "home";
export const definitions = {
  today: { tool: "acme_today", title: "Today at a Glance" },
  attention: { tool: "acme_attention", title: "Needs Your Attention" },
  goals: { tool: "acme_goals", title: "My Goals" },
  home: { tool: "acme_home", title: "Acme Home" },
};
export const resourceUri = (id: ViewId) => `ui://acme-home/${id}.html`;

const base = {
  demo: z.literal(true),
  generatedAt: z.iso.datetime(),
  generation: z.number().int().positive(),
  providerInstance: z.string().min(1),
};
export const todaySchema = z.object({
  ...base,
  kind: z.literal("today"),
  focusWindow: z.string(),
  focusNote: z.string(),
  meetings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      time: z.string(),
      detail: z.string(),
    }),
  ),
});
export const attentionSchema = z.object({
  ...base,
  kind: z.literal("attention"),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(["critical", "due", "review"]),
      detail: z.string(),
    }),
  ),
});
export const goalsSchema = z.object({
  ...base,
  kind: z.literal("goals"),
  overall: z.number().min(0).max(100),
  period: z.string(),
  goals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      progress: z.number().min(0).max(100),
      detail: z.string(),
    }),
  ),
});
export const payloadSchema = z.discriminatedUnion("kind", [
  todaySchema,
  attentionSchema,
  goalsSchema,
]);
export const homeInputSchema = z.union([
  z.object({ widget: z.never().optional() }).strict(),
  z.object({ widget: z.literal("today") }).strict(),
  z.object({ widget: z.literal("attention") }).strict(),
  z.object({ widget: z.literal("goals") }).strict(),
]);
export const homeOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shell"), demo: z.literal(true) }).strict(),
  todaySchema,
  attentionSchema,
  goalsSchema,
]);
export type Payload = z.infer<typeof payloadSchema>;
export const schemas = {
  today: todaySchema,
  attention: attentionSchema,
  goals: goalsSchema,
};
export interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}
export function parseResult(id: WidgetId, result: ToolResult): Payload {
  if (result.isError)
    throw new Error(
      "Tool request failed or was denied. Previous data retained.",
    );
  const data = payloadSchema.parse(result.structuredContent);
  if (data.kind !== id)
    throw new Error("Wrong widget response. Previous data retained.");
  return data;
}

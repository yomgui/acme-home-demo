import { randomUUID } from "node:crypto";
import type { Payload, WidgetId } from "../shared/contract.ts";

export type WidgetProvider = (id: WidgetId) => Promise<Payload>;

export function createSyntheticProvider(
  now: () => Date = () => new Date(),
): WidgetProvider {
  const generations = { today: 0, attention: 0, goals: 0 };
  const providerInstance = randomUUID();
  return async (id) => {
    const base = {
      demo: true as const,
      generation: ++generations[id],
      generatedAt: now().toISOString(),
      providerInstance,
    };
    switch (id) {
      case "today":
        return {
          ...base,
          kind: id,
          focusWindow: "2–4:30 pm",
          focusNote: "Suggested demo block; pause for the 3 pm check-in.",
          meetings: [
            {
              id: "architecture",
              title: "Architecture Review",
              time: "9:30 am",
              detail:
                "30 min · Demo architecture team · Review the platform proposal.",
            },
            {
              id: "product",
              title: "Product Sync",
              time: "11:00 am",
              detail:
                "45 min · Demo product team · Align on this week's priorities.",
            },
            {
              id: "customer",
              title: "Customer Call",
              time: "1:30 pm",
              detail:
                "30 min · Fictional account · Walk through the prototype.",
            },
            {
              id: "performance",
              title: "Performance check-in",
              time: "3:00 pm",
              detail: "20 min · Fictional manager · Discuss Q3 progress.",
            },
          ],
        };
      case "attention":
        return {
          ...base,
          kind: id,
          items: [
            {
              id: "incident",
              title: "P1 Incident Assigned",
              severity: "critical",
              detail:
                "Synthetic incident ACME-1042 · Checkout latency · Demo only, no incident system is connected.",
            },
            {
              id: "payroll",
              title: "Payroll Declaration",
              severity: "due",
              detail:
                "Illustrative payroll declaration due Friday. This app cannot submit declarations.",
            },
            {
              id: "training",
              title: "Security Training Due",
              severity: "due",
              detail:
                "Complete the fictional annual security course. No LMS is connected.",
            },
            {
              id: "goal-update",
              title: "Goal Update Requested",
              severity: "review",
              detail:
                "Review your Q3 milestones. All progress in this app is synthetic.",
            },
          ],
        };
      case "goals":
        return {
          ...base,
          kind: id,
          overall: 72,
          period: "Q3",
          goals: [
            {
              id: "platform",
              title: "Deliver platform milestones",
              progress: 80,
              detail:
                "4 of 5 illustrative milestones complete. This is not a real performance record.",
            },
            {
              id: "experience",
              title: "Improve employee experience",
              progress: 64,
              detail:
                "Synthetic progress: research complete, prototype in review.",
            },
          ],
        };
    }
  };
}

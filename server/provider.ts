import { createHash, randomUUID } from "node:crypto";
import type { Identity, Payload, WidgetId } from "../shared/contract.ts";
import type { OpenWorkIdentity } from "./upstream.ts";

export type WidgetProvider = (
  id: WidgetId,
  identity?: OpenWorkIdentity,
) => Promise<Payload>;

const people = [
  {
    name: "Maya Chen",
    role: "Platform engineer",
    avatar: "MC",
    project: "Atlas",
  },
  { name: "Noah Patel", role: "Product lead", avatar: "NP", project: "Beacon" },
  {
    name: "Amara Okafor",
    role: "Operations lead",
    avatar: "AO",
    project: "Cedar",
  },
  {
    name: "Leo Garcia",
    role: "Security analyst",
    avatar: "LG",
    project: "Drift",
  },
  { name: "Sofia Rossi", role: "Design lead", avatar: "SR", project: "Ember" },
  {
    name: "Ethan Kim",
    role: "Customer engineer",
    avatar: "EK",
    project: "Fjord",
  },
  {
    name: "Zara Ahmed",
    role: "Finance partner",
    avatar: "ZA",
    project: "Grove",
  },
  {
    name: "Oliver Reed",
    role: "Data scientist",
    avatar: "OR",
    project: "Harbor",
  },
];
export function profileForSubject(sub: string) {
  const hash = createHash("sha256").update(sub).digest("hex");
  const person = people[Number.parseInt(hash.slice(0, 8), 16) % people.length];
  if (!person) throw new Error("Missing fixture");
  const fingerprint = hash.slice(0, 12);
  const display = process.env.DEMO_VIEWER_NAME?.trim() || person.name;
  return {
    name: `${display} · ${fingerprint}`,
    firstName: display.split(/\s+/)[0] || display,
    role: person.role,
    avatar: person.avatar,
    fingerprint,
    identityMode: "per_member" as const,
    synthetic: true as const,
  };
}
export function identityKey(
  identity: Pick<OpenWorkIdentity, "identity_issuer" | "sub">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.identity_issuer, identity.sub]))
    .digest("hex");
}
export function profileForIdentity(identity: OpenWorkIdentity): Identity {
  const parts = identity.name.trim().split(/\s+/);
  return {
    name: identity.name,
    firstName: parts[0] || identity.name,
    role: "OpenWork member",
    avatar: parts
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toUpperCase(),
    fingerprint: identityKey(identity).slice(0, 12),
    identity_issuer: identity.identity_issuer,
    subjectShort: identity.sub.slice(0, 12),
    identityMode: "openwork",
    synthetic: false,
    email: identity.email,
    org_id: identity.org_id,
  };
}
export function createPersonalProvider(
  subject: string | OpenWorkIdentity,
  providerInstance = randomUUID(),
  now: () => Date = () => new Date(),
): WidgetProvider {
  const whoami =
    typeof subject === "string"
      ? profileForSubject(subject)
      : profileForIdentity(subject);
  const seed = Number.parseInt(whoami.fingerprint.slice(0, 8), 16);
  const person = people[seed % people.length];
  if (!person) throw new Error("Missing fixture");
  const generations = { today: 0, attention: 0, goals: 0 };
  return async (id, identity) => {
    const viewer = identity ? profileForIdentity(identity) : whoami;
    const generation = ++generations[id];
    const phase = (seed + generation) % 8;
    const topics = [
      "Discovery",
      "Design review",
      "Delivery planning",
      "Risk review",
      "Pilot feedback",
      "Readiness review",
      "Launch planning",
      "Retrospective",
    ];
    const topic = topics[phase];
    const project = `${person.project}-${whoami.fingerprint}`;
    const base = {
      demo: true as const,
      whoami: viewer,
      generation,
      generatedAt: now().toISOString(),
      providerInstance,
    };
    const detail = `${viewer.name} · ${viewer.role} · ${project} · Synthetic scenario ${generation}; no customer service connected.`;
    if (id === "today")
      return {
        ...base,
        kind: id,
        focusWindow: phase % 2 ? "2–3 pm" : "3–4 pm",
        focusNote: `${topic} preparation for ${project}`,
        meetings: [
          {
            id: `${project}-planning`,
            title: `${project}: ${topic}`,
            time: `${9 + (phase % 3)}:30 am`,
            detail,
          },
          {
            id: `${project}-partner`,
            title: `${project}: ${phase % 2 ? "Customer workshop" : "Partner check-in"}`,
            time: "1:00 pm",
            detail,
          },
          {
            id: `${project}-team`,
            title: `${project}: ${phase % 2 ? "Prototype review" : "Team decisions"}`,
            time: "4:00 pm",
            detail,
          },
        ],
      };
    if (id === "attention")
      return {
        ...base,
        kind: id,
        items: [
          {
            id: `${project}-incident`,
            title: `${project}: ${phase % 2 ? "Queue backlog" : "API latency"} incident`,
            severity: "critical",
            detail: `${detail} · Investigation ${generation}: ${topic}.`,
          },
          {
            id: `${project}-approval`,
            title: `${project}: ${phase % 2 ? "Access" : "Budget"} approval`,
            severity: "review",
            detail: `${detail} · Review ${1000 + (seed % 900) + generation} synthetic units; cannot approve here.`,
          },
          {
            id: `${project}-deadline`,
            title: `${project}: ${topic} due`,
            severity: "due",
            detail,
          },
        ],
      };
    const progress = 35 + ((seed + generation * 7) % 55);
    return {
      ...base,
      kind: id,
      overall: progress,
      period: "Demo quarter",
      goals: [
        {
          id: `${project}-delivery`,
          title: `${project}: ${topic} milestone`,
          progress,
          detail,
        },
        {
          id: `${project}-quality`,
          title: `${project}: ${phase % 2 ? "Improve response time" : "Reduce rework"}`,
          progress: Math.min(100, progress + 8),
          detail,
        },
      ],
    };
  };
}

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

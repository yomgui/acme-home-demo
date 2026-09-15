import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { definitions, type ViewId, type WidgetId } from "../shared/contract.ts";
import { WidgetController } from "./controller.ts";

export type Controllers = Record<WidgetId, WidgetController>;
export function Icon({ name = "box" }: { name?: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v10H6V10m4 10v-7h4v7",
    chat: "M4 4h16v12H9l-5 4V4m4 5h8m-8 3h5",
    search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    calendar: "M4 5h16v16H4V5m3-3v6m10-6v6M4 10h16",
    goal: "M21 12a9 9 0 1 1-9-9m5 9a5 5 0 1 1-5-5m0 5 9-9m-5 0h5v5",
    people:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m16-7a4 4 0 0 1 4 4v3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-4a4 4 0 0 1 0 8",
    book: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4m9 2v16",
    briefcase: "M3 7h18v14H3V7m5 0V3h8v4M3 12h18m-9-2v5",
    bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7",
    alert: "m12 3 10 18H2L12 3m0 6v5m0 3v1",
    refresh: "M20 7A9 9 0 1 0 21 14M20 2v6h-6",
    box: "M4 4h16v16H4V4m0 6h16m-10 0v10",
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.box} />
    </svg>
  );
}

function PreviewDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={onClose}>
      {children}
    </dialog>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="detail">
      <summary>
        <span>{title}</span>
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="detail-body">{children}</div>
    </details>
  );
}

export function Widget({ controller }: { controller: WidgetController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [filter, setFilter] = useState("all");
  const { data } = state;
  return (
    <section
      className={`widget widget-${controller.id}`}
      data-testid={`${controller.id}-set`}
      aria-label={definitions[controller.id].title}
    >
      <div className="widget-heading">
        <h2>
          <span className="widget-symbol">
            <Icon
              name={
                controller.id === "today"
                  ? "calendar"
                  : controller.id === "goals"
                    ? "goal"
                    : "alert"
              }
            />
          </span>
          {definitions[controller.id].title}
        </h2>
        <span className="demo-tag">DEMO</span>
      </div>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {!data && !state.error && (
        <p className="empty">
          {state.busy
            ? "Fetching synthetic data…"
            : "Waiting for widget data. Use Refresh when available."}
        </p>
      )}
      {data?.kind === "today" && (
        <>
          <div className="section-caption">
            TODAY'S SCHEDULE <span>{data.meetings.length} meetings</span>
          </div>
          <div className="schedule">
            {data.meetings.map((meeting, index) => (
              <div
                data-testid="meeting-item"
                key={meeting.id}
                className={`meeting meeting-${index}`}
              >
                <span className="meeting-time">{meeting.time}</span>
                <Details title={meeting.title}>{meeting.detail}</Details>
              </div>
            ))}
          </div>
          <div className="focus">
            <Icon name="bolt" />
            <div>
              <strong>Best focus window</strong>
              <b>{data.focusWindow}</b>
              <small>{data.focusNote}</small>
            </div>
          </div>
        </>
      )}
      {data?.kind === "attention" && (
        <>
          <div className="filter-tabs" aria-label="Filter attention">
            {["all", "critical", "due", "review"].map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "All"
                  : value[0]?.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div className="attention-list">
            {data.items
              .filter((item) => filter === "all" || item.severity === filter)
              .map((item) => (
                <div
                  data-testid="attention-item"
                  className={`attention-item ${item.severity}`}
                  key={item.id}
                >
                  <span className="severity-dot" />
                  <Details title={item.title}>
                    <span className="severity-label">{item.severity}</span>
                    {item.detail}
                  </Details>
                </div>
              ))}
          </div>
        </>
      )}
      {data?.kind === "goals" && (
        <>
          <div className="goal-overview">
            <div
              className="goal-ring"
              style={{
                background: `conic-gradient(#4772ed ${data.overall}%, #eaf0fe 0)`,
              }}
            >
              <span>
                {data.overall}
                <small>%</small>
              </span>
            </div>
            <div>
              <span className="on-track">On track</span>
              <p>{data.period} goals progress</p>
              <small>Synthetic progress, not live metrics</small>
            </div>
          </div>
          {data.goals.map((goal) => (
            <div data-testid="goal-item" className="goal-item" key={goal.id}>
              <Details title={goal.title}>{goal.detail}</Details>
              <div className="goal-progress">
                <progress
                  aria-label={goal.title}
                  max={100}
                  value={goal.progress}
                />
                <span>{goal.progress}%</span>
              </div>
            </div>
          ))}
        </>
      )}
      <footer className="widget-controls">
        <div className="refresh-line">
          <button
            className="refresh"
            onClick={() => void controller.refresh()}
            disabled={!state.available || state.busy}
          >
            <Icon name="refresh" />
            {state.busy ? "Refreshing…" : "Refresh"}
          </button>
          <label className="polling">
            <input
              type="checkbox"
              checked={state.polling}
              disabled={!state.available}
              onChange={(event) => controller.setPolling(event.target.checked)}
            />
            Auto · 60s
          </label>
        </div>
        <div className="receipt" role="status">
          {data ? (
            <>
              {data.whoami && (
                <span data-testid={`${controller.id}-identity`}>
                  Signed in as {data.whoami.name} · sub{" "}
                  {data.whoami.subjectShort ?? data.whoami.fingerprint}
                </span>
              )}
              Server generation{" "}
              <strong data-testid={`${controller.id}-generation`}>
                {data.generation}
              </strong>{" "}
              ·{" "}
              <time
                data-testid={`${controller.id}-generated-at`}
                dateTime={data.generatedAt}
              >
                {data.generatedAt}
              </time>
              <span
                data-testid={`${controller.id}-instance`}
                title={data.providerInstance}
              >
                Instance {data.providerInstance} ·
                {state.busy
                  ? "Request in progress"
                  : `${state.successes} accepted result${state.successes === 1 ? "" : "s"}`}{" "}
                · synthetic provider
              </span>
            </>
          ) : (
            "No successful result yet"
          )}
        </div>
      </footer>
    </section>
  );
}

const categories = [
  {
    title: "People & HR",
    icon: "people",
    color: "purple",
    description: "Policies, benefits & support",
    prompts: "Explore fictional benefits, leave policies and employee support.",
  },
  {
    title: "IT & Workplace",
    icon: "briefcase",
    color: "blue",
    description: "Tools, access & help",
    prompts:
      "Preview IT help. This demo cannot create tickets or grant access.",
  },
  {
    title: "Finance & Expenses",
    icon: "box",
    color: "green",
    description: "Claims, payroll & more",
    prompts:
      "Explore sample expense guidance. No payroll or payment system is connected.",
  },
  {
    title: "Learning & Career",
    icon: "book",
    color: "orange",
    description: "Grow your potential",
    prompts:
      "Discover illustrative learning paths. Enrolment is unavailable in this demo.",
  },
  {
    title: "Performance & Goals",
    icon: "goal",
    color: "pink",
    description: "Progress that matters",
    prompts: "Open My Goals below to explore synthetic Q3 milestones.",
  },
];
const navigation = [
  ["AI Chat", "chat"],
  ["Search", "search"],
  ["Agents", "bolt"],
  ["Projects", "briefcase"],
  ["Automations", "bolt"],
  ["Knowledge", "book"],
  ["Calendar", "calendar"],
];
const workNavigation = [
  ["My Tasks", "5"],
  ["My Approvals", "3"],
  ["My Incidents", "1"],
  ["My Goals", "2"],
  ["My Learning", "2"],
];

export function greeting(timeZone?: string, name?: string, now = new Date()) {
  let hour = now.getHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {}
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${period}${name?.trim() ? `, ${name.trim()}` : ""}!`;
}

export function Dashboard({
  controllers,
  view,
  connectionError,
  timeZone,
}: {
  controllers: Controllers;
  view: ViewId;
  connectionError?: string;
  timeZone?: string;
}) {
  const today = useSyncExternalStore(
    controllers.today.subscribe,
    controllers.today.getSnapshot,
    controllers.today.getSnapshot,
  );
  const attention = useSyncExternalStore(
    controllers.attention.subscribe,
    controllers.attention.getSnapshot,
    controllers.attention.getSnapshot,
  );
  const goals = useSyncExternalStore(
    controllers.goals.subscribe,
    controllers.goals.getSnapshot,
    controllers.goals.getSnapshot,
  );
  const states = [today, attention, goals];
  const needsConnection = states.some(
    (state) => state.error === "Connect to personalize",
  );
  const identity = needsConnection
    ? undefined
    : states.find((state) => state.data?.whoami)?.data?.whoami;
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [showLearning, setShowLearning] = useState(true);
  const [showPayroll, setShowPayroll] = useState(true);
  const [showLeave, setShowLeave] = useState(true);
  if (view !== "home")
    return (
      <main className="standalone">
        <div className="standalone-brand">
          Acme Home <span>SYNTHETIC DEMO</span>
        </div>
        {connectionError && <p role="alert">{connectionError}</p>}
        <Widget controller={controllers[view]} />
      </main>
    );
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="bolt" />
          </span>
          Acme Home
        </div>
        <div className="workspace-name">YOUR WORK, CONNECTED</div>
        <nav aria-label="Main navigation">
          <button className="nav-active" onClick={() => setSearch("")}>
            <Icon name="home" />
            Home
          </button>
          {navigation.map(([label, icon]) => (
            <button disabled title="Demo only — not connected" key={label}>
              <Icon name={icon} />
              {label}
            </button>
          ))}
          <div className="nav-section">MY WORK</div>
          {workNavigation.map(([label, count]) => (
            <button
              disabled
              title="Demo only — use the interactive widgets"
              key={label}
            >
              <Icon name={label === "My Goals" ? "goal" : "box"} />
              {label}
              <span className="nav-count">{count}</span>
            </button>
          ))}
          <div className="nav-divider" />
          {["Reports", "People", "Teams", "Settings"].map((label) => (
            <button disabled title="Not connected in demo" key={label}>
              <Icon name={label === "People" ? "people" : "box"} />
              {label}
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <span className="avatar">{identity?.avatar ?? "D"}</span>
          <div>
            <span data-testid="viewer-identity">
              {identity?.name ?? "Connect to personalize"}
            </span>
            <small>{identity?.role ?? "Fictional employee"}</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Employee home</span>
          <label className="global-search">
            <Icon name="search" />
            <input
              aria-label="Search demo categories"
              placeholder="Search categories, explore your workspace…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>Demo</kbd>
          </label>
          <span className="avatar">{identity?.avatar ?? "D"}</span>
        </header>
        <div className="demo-banner">
          <span className="live-dot" />
          SYNTHETIC DEMO{" "}
          <span>
            Independent MCP Apps · synthetic work data, connected-provider
            identity
          </span>
        </div>
        {connectionError && (
          <p role="alert" className="error">
            {connectionError}
          </p>
        )}
        <div className="workspace-columns">
          <main className="home-content">
            <div className="greeting">
              <div>
                <p className="eyebrow">LET'S MAKE TODAY COUNT</p>
                <h1 data-testid="viewer-greeting">
                  {greeting(timeZone, identity?.firstName)}
                </h1>
                <p>
                  Here's what your day looks like. Let's make it a great one.
                </p>
              </div>
              <span className="day-label">Your demo workspace</span>
            </div>
            <section
              className="kpi-strip"
              aria-label="Illustrative daily overview"
            >
              <div>
                <strong>4</strong>
                <span>Meetings</span>
              </div>
              <div>
                <strong>3</strong>
                <span>Replies</span>
              </div>
              <div>
                <strong>5</strong>
                <span>Tasks</span>
              </div>
              <div>
                <strong className="critical-number">1</strong>
                <span>Critical item</span>
              </div>
              <div className="kpi-focus">
                <Icon name="bolt" />
                <span>
                  Best focus window<strong>2–4:30 pm</strong>
                </span>
              </div>
            </section>
            <section className="assistant-card">
              <div className="assistant-title">
                <span className="assistant-icon">
                  <Icon name="bolt" />
                </span>
                <h2>Ask anything or get work done</h2>
              </div>
              <p>Your AI partner for a more productive day.</p>
              <div className="composer-form">
                <textarea
                  aria-label="Demo assistant prompt"
                  placeholder="Ask a question, find information, or start a task…"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <div className="composer-bottom">
                  <span>Local preview only · no messages sent</span>
                  <button
                    type="button"
                    disabled={!prompt.trim()}
                    onClick={() =>
                      setDialog({
                        title: "Local demo response",
                        body: `You asked: “${prompt.trim()}”. This is a local preview, not an AI response. Nothing was sent. Explore the three widgets to make real MCP tool calls against synthetic data.`,
                      })
                    }
                  >
                    Preview response <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </div>
              <div className="prompt-chips">
                {[
                  "Help me plan my day",
                  "Explore my benefits",
                  "Review my goals",
                ].map((text) => (
                  <button key={text} onClick={() => setPrompt(text)}>
                    {text}
                  </button>
                ))}
              </div>
            </section>
            <section
              className="category-section"
              aria-label="Explore categories"
            >
              <h2>How can we help you today?</h2>
              <div className="categories">
                {categories
                  .filter((category) =>
                    `${category.title} ${category.description}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((category) => (
                    <button
                      className={`category ${category.color}`}
                      key={category.title}
                      onClick={() =>
                        setDialog({
                          title: `${category.title} · local preview`,
                          body: category.prompts,
                        })
                      }
                    >
                      <span className="category-icon">
                        <Icon name={category.icon} />
                      </span>
                      <strong>{category.title}</strong>
                      <small>{category.description}</small>
                    </button>
                  ))}
              </div>
              {!categories.some((category) =>
                `${category.title} ${category.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && <p>No demo categories match “{search}”.</p>}
            </section>
            <div className="widgets-title">
              <h2>Your Widgets</h2>
              <button
                onClick={() =>
                  setDialog({
                    title: "Customize demo widgets",
                    body: "Choose which static illustrative tiles to display. The three MCP widgets stay independent and always available.",
                  })
                }
              >
                Customize
              </button>
            </div>
            <div className="bottom-widgets">
              <Widget controller={controllers.goals} />
              <div className="static-widgets">
                {showLearning && (
                  <section className="static-tile">
                    <span className="tile-icon purple">
                      <Icon name="book" />
                    </span>
                    <h3>My Learning</h3>
                    <strong>
                      2 <small>of 5</small>
                    </strong>
                    <p>Courses completed</p>
                    <progress
                      max="5"
                      value="2"
                      aria-label="Illustrative learning progress"
                    />
                    <span className="static-label">Illustration only</span>
                  </section>
                )}
                {showPayroll && (
                  <section className="static-tile">
                    <span className="tile-icon green">
                      <Icon name="briefcase" />
                    </span>
                    <h3>Payroll</h3>
                    <strong>All set</strong>
                    <p>Next pay: Sep 30</p>
                    <span className="static-label">Illustration only</span>
                  </section>
                )}
                {showLeave && (
                  <section className="static-tile">
                    <span className="tile-icon orange">
                      <Icon name="calendar" />
                    </span>
                    <h3>Leave Balance</h3>
                    <strong>
                      14 <small>days</small>
                    </strong>
                    <p>Available balance</p>
                    <span className="static-label">Illustration only</span>
                  </section>
                )}
                <button
                  className="add-widget"
                  onClick={() =>
                    setDialog({
                      title: "Customize demo widgets",
                      body: "Choose which static illustrative tiles to display. The three MCP widgets stay independent and always available.",
                    })
                  }
                >
                  <span>+</span>Add Widget
                </button>
              </div>
            </div>
            <p className="page-note">
              Demo KPI and auxiliary tiles are fixed illustrations. Widget
              generation and server time reflect actual tool responses. Per-user
              scenarios rotate on Refresh; shared-mode fixtures stay stable.
            </p>
          </main>
          <aside className="right-column" aria-label="Your day and priorities">
            <Widget controller={controllers.today} />
            <Widget controller={controllers.attention} />
            <section className="quick-actions">
              <h2>
                Quick Actions <span>LOCAL PREVIEWS</span>
              </h2>
              <div>
                {[
                  "Request leave",
                  "Raise IT ticket",
                  "Submit expense",
                  "Find a colleague",
                ].map((title) => (
                  <button
                    key={title}
                    onClick={() =>
                      setDialog({
                        title: `${title} · preview`,
                        body: "This is a synthetic demonstration. No request was created and no customer service is connected.",
                      })
                    }
                  >
                    {title}
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
      {dialog && (
        <PreviewDialog title={dialog.title} onClose={() => setDialog(null)}>
          <h2>{dialog.title}</h2>
          <p>{dialog.body}</p>
          {dialog.title === "Customize demo widgets" && (
            <div className="customize-options">
              <label>
                <input
                  type="checkbox"
                  checked={showLearning}
                  onChange={(event) => setShowLearning(event.target.checked)}
                />
                Learning illustration
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showPayroll}
                  onChange={(event) => setShowPayroll(event.target.checked)}
                />
                Payroll illustration
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showLeave}
                  onChange={(event) => setShowLeave(event.target.checked)}
                />
                Leave illustration
              </label>
            </div>
          )}
          <button autoFocus className="primary" onClick={() => setDialog(null)}>
            Close preview
          </button>
        </PreviewDialog>
      )}
    </div>
  );
}

import {
  definitions,
  parseResult,
  isAuthFailure,
  type Payload,
  type ToolResult,
  type WidgetId,
} from "../shared/contract.ts";

export type ToolCall = (
  name: string,
  signal: AbortSignal,
) => Promise<ToolResult>;
export interface WidgetState {
  data: Payload | null;
  busy: boolean;
  polling: boolean;
  available: boolean;
  error: string | null;
  attempts: number;
  successes: number;
}
export interface Clock {
  every: (callback: () => void, ms: number) => () => void;
}
const clock: Clock = {
  every: (callback, ms) => {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  },
};

export class WidgetController {
  private state: WidgetState = {
    data: null,
    busy: false,
    polling: false,
    available: false,
    error: null,
    attempts: 0,
    successes: 0,
  };
  private listeners = new Set<() => void>();
  private cancelTimer: (() => void) | undefined;
  private request: AbortController | undefined;
  private stopped = false;

  constructor(
    readonly id: WidgetId,
    private readonly call: ToolCall,
    private readonly timers: Clock = clock,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<WidgetState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setAvailable(available: boolean) {
    if (!available) {
      this.setPolling(false);
      this.request?.abort();
    }
    this.update({
      available,
      error: available
        ? null
        : "Host does not allow server tool calls. Refresh and polling are unavailable.",
    });
  }

  accept(result: ToolResult) {
    const data = parseResult(this.id, result);
    const previous = this.state.data;
    if (
      previous &&
      previous.whoami?.fingerprint === data.whoami?.fingerprint &&
      (Date.parse(data.generatedAt) < Date.parse(previous.generatedAt) ||
        (data.providerInstance === previous.providerInstance &&
          data.generation < previous.generation))
    )
      throw new Error("Older response ignored. Previous data retained.");
    this.update({
      data,
      error: this.state.available ? null : this.state.error,
      successes: this.state.successes + 1,
    });
  }

  receive(result: ToolResult) {
    try {
      this.accept(result);
    } catch (error) {
      this.fail(error);
    }
  }

  requireConnection() {
    if (
      this.state.error === "Connect to personalize" &&
      !this.state.data &&
      !this.state.busy
    )
      return;
    this.request?.abort();
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.update({
      data: null,
      busy: false,
      polling: false,
      error: "Connect to personalize",
    });
  }

  private fail(error: unknown) {
    if (isAuthFailure(error)) {
      this.requireConnection();
      return;
    }
    this.setPolling(false);
    this.update({
      error: `${error instanceof Error ? error.message : "Request failed."} Polling paused; retry manually.`,
    });
  }

  refresh = async () => {
    if (this.stopped || this.state.busy || !this.state.available) return false;
    const request = new AbortController();
    this.request = request;
    this.update({ busy: true, attempts: this.state.attempts + 1 });
    try {
      const result = await this.call(definitions[this.id].tool, request.signal);
      if (!this.stopped && !request.signal.aborted) this.accept(result);
    } catch (error) {
      if (!this.stopped && !request.signal.aborted) this.fail(error);
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.update({ busy: false });
      }
    }
    return true;
  };

  setPolling = (enabled: boolean) => {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    const polling = enabled && this.state.available && !this.stopped;
    this.update({ polling });
    if (polling)
      this.cancelTimer = this.timers.every(() => {
        void this.refresh();
      }, 60_000);
  };

  stop() {
    this.setPolling(false);
    this.request?.abort();
    this.stopped = true;
    this.listeners.clear();
  }
}

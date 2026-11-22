import type { AgentAction } from "@ui-sdk/react/agent";

import type { Point } from "@/lib/map/types";

import { getIsAgentAskFirst, getIsAgentRead } from "./agent-actions";

export interface AgentTrailStep {
  action: string;
  label: string;
}

export interface AgentRequest {
  id: number;
  steps: AgentTrailStep[];
  todo: string[];
  at: Point | null;
  stopped: boolean;
}

export interface AgentQuestion {
  id: number;
  action: string;
  args: unknown[];
  confirm?: string;
}

export interface AgentSessionState {
  status: "idle" | "working" | "asking";
  request: AgentRequest | null;
  question: AgentQuestion | null;
}

interface AgentSessionOptions {
  // How long the agent shows as working after its last call.
  busyMs?: number;
  // How long a pause ends a request, so the next call starts another.
  requestGapMs?: number;
  now?: () => number;
}

interface Pending {
  action: string;
  args: unknown[];
  at: number;
}

// Whether the card has something to show: a question, a step to undo, or a
// stopped request to close.
export function getHasAgentCard({ question, request }: AgentSessionState) {
  return Boolean(
    question || (request && (request.steps.length > 0 || request.stopped)),
  );
}

export const idleAgentSession: AgentSessionState = {
  status: "idle",
  request: null,
  question: null,
};

// What a browser's agent is doing to the map. WebMCP sends one tool call at a
// time, so calls count as one request, with one trail, one Stop and one Undo
// all, until a long pause, the person's own edit or closing the card.
export function createAgentSession({
  busyMs = 15_000,
  requestGapMs = 60_000,
  now = Date.now,
}: AgentSessionOptions = {}) {
  let state = idleAgentSession;
  const listeners = new Set<() => void>();
  let nextId = 1;
  let lastAt = -Infinity;
  let ended = false;
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: Pending | null = null;
  let settle: ((yes: boolean) => void) | null = null;
  let askFirstAllowed = false;

  const set = (next: Partial<AgentSessionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const setRequest = (next: Partial<AgentRequest>) => {
    if (state.request) set({ request: { ...state.request, ...next } });
  };

  const settleLater = () => {
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => {
      if (state.status === "working") set({ status: "idle" });
    }, busyMs);
  };

  // A stopped request keeps refusing until the person closes its card.
  const touch = () => {
    const at = now();
    const stale = ended || at - lastAt > requestGapMs;
    if (!state.request || (stale && !state.request.stopped)) {
      set({
        request: { id: nextId, steps: [], todo: [], at: null, stopped: false },
      });
      nextId += 1;
      ended = false;
    }
    lastAt = at;
  };

  const callGapMs = 3000;

  const getHasPending = () => pending !== null && now() - pending.at <= busyMs;

  const stop = () => {
    setRequest({ stopped: true });
    pending = null;
    settle?.(false);
    clearTimeout(busyTimer);
    set({ status: "idle" });
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    // Decides one WebMCP step, asking the person first when it takes
    // something away.
    allow(step: AgentAction, signal?: AbortSignal): boolean | Promise<boolean> {
      touch();
      if (state.request?.stopped) return false;
      const ask =
        Boolean(step.confirm) ||
        (getIsAgentAskFirst(step.action, step.args) && !askFirstAllowed);
      if (!ask) {
        pending = getIsAgentRead(step.action)
          ? null
          : { action: step.action, args: step.args, at: now() };
        set({ status: "working" });
        settleLater();
        return true;
      }
      clearTimeout(busyTimer);
      return new Promise<boolean>((resolve) => {
        const finish = (yes: boolean) => {
          signal?.removeEventListener("abort", onAbort);
          settle = null;
          lastAt = now();
          pending = yes
            ? { action: step.action, args: step.args, at: now() }
            : null;
          set({ status: yes ? "working" : "idle", question: null });
          if (yes) settleLater();
          resolve(yes);
        };
        const onAbort = () => finish(false);
        signal?.addEventListener("abort", onAbort);
        settle = finish;
        set({
          status: "asking",
          question: {
            id: nextId,
            action: step.action,
            args: step.args,
            confirm: step.confirm,
          },
        });
        nextId += 1;
      });
    },
    answer(yes: boolean, { always = false } = {}) {
      const question = state.question;
      if (yes && always && question && !question.confirm) {
        askFirstAllowed = true;
      }
      settle?.(yes);
    },
    // The request an edit landing now belongs to, if a WebMCP step made it.
    currentRequest() {
      return getHasPending() ? (state.request?.id ?? null) : null;
    },
    // The person edited the map, so the agent's next call starts a new
    // request.
    endRequest() {
      pending = null;
      ended = true;
    },
    // Adds an edit to the trail when a WebMCP step made it. False means the
    // edit came from somewhere else.
    record(
      action: string,
      todo: string[],
      summarize: (args: unknown[]) => { label: string; at: Point | null },
    ) {
      if (!getHasPending() || pending?.action !== action || !state.request) {
        return false;
      }
      const { label, at } = summarize(pending.args);
      pending = null;
      lastAt = now();
      setRequest({
        steps: [...state.request.steps, { action, label }],
        todo,
        at: at ?? state.request.at,
      });
      return true;
    },
    stop,
    // Whether a call came in just now, so more of the same request may follow.
    getIsCalling: () => now() - lastAt < callGapMs,
    // Empties the trail after Undo all took it back, keeping the request.
    clearTrail() {
      setRequest({ steps: [], todo: [], at: null });
    },
    dismiss() {
      if (state.status !== "idle") return;
      ended = true;
      set({ request: null });
    },
    // Forgets everything, as when the editor closes or shows another map.
    reset() {
      settle?.(false);
      pending = null;
      ended = true;
      clearTimeout(busyTimer);
      set(idleAgentSession);
    },
  };
}

export type AgentSession = ReturnType<typeof createAgentSession>;

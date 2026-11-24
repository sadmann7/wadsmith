import { Bot, Check, LoaderCircle, X } from "lucide-react";
import * as React from "react";

import type { GameMap } from "@/lib/map/types";
import type { CustomThings } from "@/lib/wad/custom-things";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { agentRisk } from "@/lib/editor/agent-actions";
import {
  type AgentSessionState,
  getAgentStepsOnMap,
  getHasAgentCard,
} from "@/lib/editor/agent-session";

interface AgentCardProps {
  session: AgentSessionState;
  map: GameMap;
  customThings: CustomThings;
  doneEdits: ReadonlySet<number>;
  onAnswer: (yes: boolean, always: boolean) => void;
  onStop: () => void;
  onUndoAll: () => void;
  onDismiss: () => void;
}

export function AgentCard({
  session,
  map,
  customThings,
  doneEdits,
  onAnswer,
  onStop,
  onUndoAll,
  onDismiss,
}: AgentCardProps) {
  const { status, request, question } = session;
  if (question) {
    return (
      <AgentQuestionCard
        key={question.id}
        question={question}
        map={map}
        customThings={customThings}
        onAnswer={onAnswer}
      />
    );
  }
  if (!request || !getHasAgentCard(session, doneEdits)) return null;
  const working = status === "working";
  const steps = getAgentStepsOnMap(request.steps, doneEdits);
  const changes = steps.length;
  return (
    <section
      data-agent-card
      data-agent-hidden
      aria-label="What the agent did"
      className="absolute bottom-3 left-3 z-5 grid w-[min(520px,calc(100%-24px))] rounded-[6px] border border-input bg-card text-foreground shadow-popover"
    >
      <header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-3 text-sm">
        <Bot size={14} aria-hidden="true" />
        <span className="font-semibold">Agent</span>
        <span className="text-muted-foreground">
          through your browser ·{" "}
          {changes === 1 ? "1 change" : `${changes} changes`}
          {request.stopped ? " · stopped" : ""}
        </span>
        {working ? null : (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-6"
            aria-label="Close"
            onClick={onDismiss}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        )}
      </header>
      {changes > 0 || working ? (
        <ol
          ref={(list) => {
            if (list) list.scrollTop = list.scrollHeight;
          }}
          className="grid max-h-40 gap-2.5 overflow-y-auto p-3 text-sm"
        >
          {steps.map((step) => (
            <li key={step.undoStep} className="flex items-center gap-2.5">
              <Check
                size={14}
                className="shrink-0 text-success"
                aria-hidden="true"
              />
              {step.label}
            </li>
          ))}
          {working ? (
            <li className="flex items-center gap-2.5 text-muted-foreground">
              <LoaderCircle
                size={14}
                className="shrink-0 motion-safe:animate-spin"
                aria-hidden="true"
              />
              Working…
            </li>
          ) : null}
        </ol>
      ) : null}
      <footer className="flex items-center gap-2 border-t border-border py-2 pr-3 pl-3">
        <span className="mr-auto text-sm text-muted-foreground">
          {request.todo.length > 0
            ? `Still to do: ${request.todo.join(" ")}`
            : null}
        </span>
        {working ? (
          <Button variant="ghost" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        {changes > 0 ? <Button onClick={onUndoAll}>Undo all</Button> : null}
      </footer>
    </section>
  );
}

interface AgentQuestionCardProps {
  question: NonNullable<AgentSessionState["question"]>;
  map: GameMap;
  customThings: CustomThings;
  onAnswer: (yes: boolean, always: boolean) => void;
}

function AgentQuestionCard({
  question,
  map,
  customThings,
  onAnswer,
}: AgentQuestionCardProps) {
  const [always, setAlways] = React.useState(false);
  const refuse = React.useRef<HTMLButtonElement>(null);
  // Worked out once per question, since a texture swap counts every surface.
  const [risk] = React.useState(() =>
    question.confirm
      ? { title: question.confirm, detail: "", confirm: "Allow" }
      : agentRisk(map, question.action, question.args, customThings),
  );
  // Focus moves to the question unless the person is typing somewhere, and
  // goes back once it's answered.
  React.useEffect(() => {
    const before = document.activeElement;
    if (before?.matches("input, textarea, select, [contenteditable]")) return;
    refuse.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  return (
    <section
      data-agent-card
      data-agent-hidden
      role="alertdialog"
      aria-labelledby="agent-ask-title"
      aria-describedby={risk.detail ? "agent-ask-detail" : undefined}
      className="absolute bottom-3 left-3 z-5 grid w-[min(520px,calc(100%-24px))] rounded-[6px] border border-input bg-popover text-foreground shadow-popover"
    >
      <div className="grid gap-2 px-5 pt-5 pb-4">
        <p className="flex items-center gap-1.5 font-mono text-xs tracking-wide text-muted-foreground uppercase">
          <Bot size={12} aria-hidden="true" />
          The agent wants to
        </p>
        <h2 id="agent-ask-title" className="text-xl font-semibold">
          {risk.title}
        </h2>
        {risk.detail ? (
          <p id="agent-ask-detail" className="text-base text-muted-foreground">
            {risk.detail}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border py-2.5 pr-3 pl-5">
        {question.confirm ? (
          <span className="mr-auto" />
        ) : (
          <label className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={always}
              onCheckedChange={(checked) => setAlways(checked === true)}
            />
            Don't ask again until I reload
          </label>
        )}
        <Button ref={refuse} onClick={() => onAnswer(false, false)}>
          Don't allow
        </Button>
        <Button variant="destructive" onClick={() => onAnswer(true, always)}>
          {risk.confirm}
        </Button>
      </div>
    </section>
  );
}

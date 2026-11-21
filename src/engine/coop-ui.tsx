import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { MapPlan } from "../editor/map-plan";
import type { GameMap } from "../map/types";
import { formatRoomCode } from "./room";

// Doom's own player colors: green, indigo, brown and red.
const playerColors = [
  "border-success text-success",
  "border-info text-info",
  "border-warning text-warning",
  "border-danger text-danger",
];

function PlayerBadge({ peer, open = false }: { peer: number; open?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-xs ${
        open
          ? "border-dashed border-border-strong text-fg-muted"
          : (playerColors[peer - 1] ?? playerColors[0])
      }`}
    >
      {peer}
    </span>
  );
}

function CardPreview({ map, code }: { map: GameMap; code?: string }) {
  return (
    <div className="relative shrink-0 border-b border-border bg-map-bg">
      <MapPlan map={map} className="h-24 w-full p-4" />
      {code ? (
        <span
          aria-label="Room code"
          className="absolute top-3 right-3 rounded-[3px] border border-border-strong bg-surface px-2 py-1 font-mono text-xs tracking-[0.06em]"
        >
          {formatRoomCode(code)}
        </span>
      ) : null}
    </div>
  );
}

function CardHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="font-mono text-xs tracking-[0.08em] text-fg-muted uppercase">
        {eyebrow}
      </span>
      {title}
      {detail ? <span className="text-sm text-fg-soft">{detail}</span> : null}
    </div>
  );
}

function SectionLabel({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex justify-between border-b border-border pb-1.5 font-mono text-xs tracking-[0.08em] text-fg-muted uppercase">
      <span>{children}</span>
      {aside}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block font-mono text-xs tracking-[0.08em] text-fg-muted uppercase">
      {children}
    </span>
  );
}

function Choice<Value extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string; disabled?: boolean; hint?: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-[3px] rounded-[3px] border border-border bg-canvas p-[3px]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.hint}
          className="h-[26px] flex-1 rounded-[2px] border-0 bg-transparent px-3 text-sm text-fg-muted hover:text-fg disabled:opacity-40 aria-pressed:bg-surface-hover aria-pressed:font-semibold aria-pressed:text-fg"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CoopCard({
  label,
  map,
  code,
  footer,
  children,
}: {
  label: string;
  map: GameMap;
  code?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-[6px] border border-border-strong bg-surface"
    >
      <CardPreview map={map} code={code} />
      <div className="grid gap-[18px] px-6 pt-5 pb-6">{children}</div>
      {footer ? (
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-3 px-6 pb-5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  tone: "info" | "warning" | "danger";
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const color = {
    info: "text-info",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];
  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-[6px] border border-border-strong bg-surface p-6"
    >
      <h2 className="m-0 flex items-center gap-2.5 text-xl font-bold">
        <Icon size={18} aria-hidden="true" className={color} />
        {title}
      </h2>
      <div className="grid gap-3 text-base text-fg-soft">{children}</div>
      {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
    </section>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between font-mono text-xs text-fg-muted">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-info" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export {
  CardHeading,
  CardPreview,
  Choice,
  CoopCard,
  FieldLabel,
  PlayerBadge,
  Progress,
  SectionLabel,
  StatusCard,
};

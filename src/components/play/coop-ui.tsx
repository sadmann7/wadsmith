import type { LucideIcon } from "lucide-react";

import * as React from "react";

import type { GameMap } from "@/lib/map/types";

import { MapPlan } from "@/components/map-plan";
import { playerColor } from "@/lib/engine/player-colors";
import { formatRoomCode } from "@/lib/engine/room";

interface PlayerBadgeProps {
  slot: number;
  open?: boolean;
}

export function PlayerBadge({ slot, open = false }: PlayerBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-xs ${
        open
          ? "border-dashed border-input text-muted-foreground"
          : playerColor(slot).badge
      }`}
    >
      {slot + 1}
    </span>
  );
}

interface CardPreviewProps {
  map: GameMap;
  code?: string;
}

export function CardPreview({ map, code }: CardPreviewProps) {
  return (
    <div className="relative shrink-0 border-b border-border bg-map-bg">
      <MapPlan map={map} className="h-24 w-full p-4" />
      {code ? (
        <span
          aria-label="Room code"
          className="absolute top-3 right-3 rounded-[3px] border border-input bg-card px-2 py-1 font-mono text-xs tracking-[0.06em]"
        >
          {formatRoomCode(code)}
        </span>
      ) : null}
    </div>
  );
}

interface CardHeadingProps {
  eyebrow: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
}

export function CardHeading({ eyebrow, title, detail }: CardHeadingProps) {
  return (
    <div className="grid gap-1.5">
      <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
        {eyebrow}
      </span>
      {title}
      {detail ? (
        <span className="text-sm text-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

interface SectionLabelProps {
  children: React.ReactNode;
  aside?: React.ReactNode;
}

export function SectionLabel({ children, aside }: SectionLabelProps) {
  return (
    <div className="flex justify-between border-b border-border pb-1.5 font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
      <span>{children}</span>
      {aside}
    </div>
  );
}

interface FieldLabelProps {
  children: React.ReactNode;
}

export function FieldLabel({ children }: FieldLabelProps) {
  return (
    <span className="mb-1.5 block font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

interface ChoiceProps<Value extends string | number> {
  label: string;
  value: Value;
  options: { value: Value; label: string; disabled?: boolean; hint?: string }[];
  onChange: (value: Value) => void;
}

export function Choice<Value extends string | number>({
  label,
  value,
  options,
  onChange,
}: ChoiceProps<Value>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-[3px] rounded-[3px] bg-muted p-[3px]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.hint}
          className="h-[26px] flex-1 rounded-[2px] border-0 bg-transparent px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 aria-pressed:bg-input/30 aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface CoopCardProps {
  label: string;
  map: GameMap;
  code?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function CoopCard({
  label,
  map,
  code,
  footer,
  children,
}: CoopCardProps) {
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-[6px] border border-input bg-card"
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

interface StatusCardProps {
  icon: LucideIcon;
  tone: "info" | "warning" | "danger";
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function StatusCard({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: StatusCardProps) {
  const color = {
    info: "text-info",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone];
  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-[6px] border border-input bg-card p-6"
    >
      <h2 className="m-0 flex items-center gap-2.5 text-xl font-bold">
        <Icon size={18} aria-hidden="true" className={color} />
        {title}
      </h2>
      <div className="grid gap-3 text-base text-foreground">{children}</div>
      {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
    </section>
  );
}

interface ProgressProps {
  label: string;
  value: number;
}

export function Progress({ label, value }: ProgressProps) {
  const percent = Math.round(value * 100);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-info" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

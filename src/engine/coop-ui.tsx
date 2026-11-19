import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

function PlayerBadge({ peer, open = false }: { peer: number; open?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] ${
        open
          ? "border-border-strong text-fg-muted"
          : "border-warning text-warning"
      }`}
    >
      {peer}
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
      className="flex rounded-[3px] bg-canvas p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.hint}
          className="flex-1 rounded-[2px] border-0 bg-transparent px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg disabled:opacity-40 aria-pressed:bg-surface-raised aria-pressed:font-semibold aria-pressed:text-fg"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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
      className="grid gap-3 rounded-[4px] border border-border-strong bg-surface p-5"
    >
      <h2 className="m-0 flex items-center gap-2.5 text-lg font-semibold">
        <Icon size={18} aria-hidden="true" className={color} />
        {title}
      </h2>
      <div className="grid gap-3 text-sm text-fg-soft">{children}</div>
      {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
    </section>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between font-mono text-[11px] text-fg-muted">
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

export { Choice, PlayerBadge, Progress, StatusCard };

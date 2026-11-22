import type * as React from "react";

export function LogoMark(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 14l12 36 12-24 12 24 12-36"
        className="stroke-primary"
        strokeWidth={7}
        strokeLinejoin="bevel"
      />
      <path
        className="fill-foreground"
        d="M3 9h10v10H3zM15 45h10v10H15zM27 21h10v10H27zM39 45h10v10H39zM51 9h10v10H51z"
      />
    </svg>
  );
}

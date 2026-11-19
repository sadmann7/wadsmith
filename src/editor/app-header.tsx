import Link from "next/link";
import type { ReactNode } from "react";

function AppHeader({
  onHome,
  children,
}: {
  onHome: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <h1 className="m-0 shrink-0">
        <Link
          href="/"
          className="text-accent no-underline"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            onHome();
          }}
        >
          WADSMITH
        </Link>
      </h1>
      {children}
    </header>
  );
}

export { AppHeader };

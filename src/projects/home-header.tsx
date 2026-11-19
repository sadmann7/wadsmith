type HomeView = "projects" | "featured";

const views: { value: HomeView; label: string }[] = [
  { value: "projects", label: "Episodes" },
  { value: "featured", label: "Featured maps" },
];

function HomeHeader({
  view,
  onNavigate,
}: {
  view: HomeView;
  onNavigate: (view: HomeView) => void;
}) {
  return (
    <header className="flex items-stretch gap-8 border-b border-border bg-surface pr-3 pl-4">
      <h1 className="m-0 self-center text-[17px] font-bold tracking-[0.02em] text-accent">
        WADSMITH
      </h1>
      <nav aria-label="Sections" className="flex items-stretch gap-5">
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-current={view === item.value ? "page" : undefined}
            className="border-0 border-b-2 border-transparent bg-transparent px-0.5 pt-0.5 text-[13px] text-fg-muted hover:text-fg aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-fg"
            onClick={() => onNavigate(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

export { HomeHeader, type HomeView };

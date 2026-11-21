type ClassValue = string | false | null | undefined;

function cn(...classes: ClassValue[]): string;
function cn<State>(
  ...classes: (ClassValue | ((state: State) => ClassValue))[]
): string | ((state: State) => string);
// A UI SDK part's class name can be a function of its state, so the joined
// class names become one too.
function cn<State>(
  ...classes: (ClassValue | ((state: State) => ClassValue))[]
) {
  const join = (state: State) =>
    classes
      .map((value) => (typeof value === "function" ? value(state) : value))
      .filter(Boolean)
      .join(" ");
  return classes.some((value) => typeof value === "function")
    ? join
    : join(undefined as State);
}

export { cn };

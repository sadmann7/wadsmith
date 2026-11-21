import { cn as merge, type ClassValue } from "cn";

function cn(...classes: ClassValue[]): string;
function cn<State>(
  ...classes: (ClassValue | ((state: State) => ClassValue))[]
): string | ((state: State) => string);
// A UI SDK part's class name can be a function of its state, so the merged
// class names become one too.
function cn<State>(
  ...classes: (ClassValue | ((state: State) => ClassValue))[]
) {
  const join = (state: State) =>
    merge(
      classes.map((value) =>
        typeof value === "function" ? value(state) : value,
      ),
    );
  return classes.some((value) => typeof value === "function")
    ? join
    : join(undefined as State);
}

export { cn };

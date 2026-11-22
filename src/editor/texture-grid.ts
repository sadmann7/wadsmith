import {
  createChange,
  createRovingFocus,
  definePrimitive,
  selects,
  spatialMove,
  type ChangeDetails,
  type RovingFocusMoveContext,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

interface TextureGridOptions {
  value?: string;
  names?: readonly string[];
  onValueChange?: (value: string, details: ChangeDetails<"keyboard">) => void;
  onApply?: (value: string) => void;
  onReveal?: (value: string) => void;
  onLeave?: () => void;
  onType?: (text: string | null) => void;
}

interface TextureGridState {
  value: string;
  focused: string | null;
}

const moveSpatially = spatialMove();

function isTypedKey(event: KeyboardEvent) {
  return (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

const textureGrid = definePrimitive({
  name: "texture-grid",
  options: {
    value: "string",
    names: "value",
    onValueChange: "callback",
    onApply: "callback",
    onReveal: "callback",
    onLeave: "callback",
    onType: "callback",
  },
  controlled: ["value"],
  state: (options: TextureGridOptions): TextureGridState => ({
    value: options.value ?? "",
    focused: null,
  }),
  sync: (options) =>
    options.value === undefined ? {} : { value: options.value },
  api: (context) => {
    const { store } = context;
    const change = createChange(context);

    // Tiles past the loaded pages have no element, so spatial search can't see them.
    const move = (event: KeyboardEvent, moves: RovingFocusMoveContext) => {
      const { from, items } = moves;
      const names = context.options().names ?? [];
      const index = names.indexOf(from.key);
      const top = items[0]?.el.offsetTop;
      const columns = Math.max(
        1,
        items.filter(({ el }) => el.offsetTop === top).length,
      );
      const rowHeight = (items[columns]?.el.offsetTop ?? 0) - (top ?? 0);
      const scroller = from.el.closest("[role=listbox]")?.parentElement;
      const rows = Math.max(
        1,
        Math.floor((scroller?.clientHeight ?? 0) / (rowHeight || 1)),
      );
      const targets: Record<string, number | undefined> = {
        Home: 0,
        End: names.length - 1,
        PageDown: Math.min(names.length - 1, index + columns * rows),
        PageUp: Math.max(0, index - columns * rows),
      };
      const target = targets[event.key];
      let key = target === undefined ? undefined : names[target];
      if (target === undefined) {
        key = moveSpatially(event, moves);
        if (!key && event.key === "ArrowRight") key = names[index + 1];
        if (!key && event.key === "ArrowLeft") key = names[index - 1];
        if (!key && event.key === "ArrowDown") {
          key = names[index + columns] ?? names.at(-1);
        }
      }
      if (key && !items.some((item) => item.key === key)) {
        context.options().onReveal?.(key);
      }
      return key;
    };

    const roving = createRovingFocus<TextureGridState, { value: string }>(
      context,
      {
        slot: "item",
        key: "focused",
        remember: false,
        move,
        preferred: (item) => item.key === store.get().value,
        claims: (state, item) => item.key === state.value,
      },
    );

    return {
      roving,
      keydown(event: KeyboardEvent, el: HTMLElement, key: string) {
        const { onApply, onLeave, onType } = context.options();
        if (event.key === "Enter") {
          event.preventDefault();
          onApply?.(key);
          return;
        }
        if (event.key === "Backspace" || isTypedKey(event)) {
          event.preventDefault();
          onType?.(event.key === "Backspace" ? null : event.key);
          return;
        }
        const moved = roving.keydown(event, el);
        if (moved && moved.key !== moved.from) {
          change("value", moved.key, { reason: "keyboard", event });
        } else if (!moved && event.key === "ArrowUp") {
          event.preventDefault();
          onLeave?.();
        }
      },
      press(key: string, event: Event) {
        change("value", key, { reason: "keyboard", event });
      },
      apply(key: string) {
        context.options().onApply?.(key);
      },
    };
  },
  slots: (slot) => ({
    root: slot({ attrs: () => ({ role: "listbox" }) }),
    item: slot<{ value: string }>({
      props: { value: "string" },
      selects: selects({
        focused: ({ key }) => [key, null],
        value: ({ key }) => [key],
      }),
      attrs: (state, part) => ({
        type: "button",
        role: "option",
        "data-texture": part.key,
        "aria-selected": String(state.value === part.key),
        tabindex: part.api.roving.tabIndex(state, part),
      }),
      on: {
        keydown: (event, { api, el, key }) => api.keydown(event, el!, key),
        click: (event, { api, key }) => api.press(key, event),
        dblclick: (_event, { api, key }) => api.apply(key),
        focus: (_event, { el }) => el?.scrollIntoView({ block: "nearest" }),
      },
      bind: (el, part) => part.api.roving.bind(el, part),
    }),
  }),
});

const parts = createParts(textureGrid, { root: "div", item: "button" });
const TextureGrid = parts.Root;
const TextureTile = parts.Item;

export { TextureGrid, TextureTile };

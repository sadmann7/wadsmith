"use client";

import {
  type ChangeDetails,
  createChange,
  createReorder,
  definePrimitive,
  type ReorderDraft,
  type ReorderReason,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import { defined } from "@/lib/defined";

interface MapOrderOptions {
  value?: string[];
  onValueChange?: (
    value: string[],
    details: ChangeDetails<ReorderReason>,
  ) => void;
  label?: (id: string) => string | undefined;
}

interface MapOrderState {
  value: string[];
  moving: ReorderDraft | null;
}

const mapOrder = definePrimitive({
  name: "map-order",
  options: { value: "list", onValueChange: "callback", label: "callback" },
  controlled: ["value"],
  state: (options: MapOrderOptions): MapOrderState => ({
    value: options.value ?? [],
    moving: null,
  }),
  sync: (options) =>
    options.value === undefined ? {} : { value: options.value },
  api: (context) => {
    const change = createChange(context);
    const reorder = createReorder(context, {
      slot: "row",
      key: "value",
      draft: "moving",
      set: (value, details) => change("value", value, details),
      preview: true,
      label: (id) => context.options().label?.(id),
    });
    return { reorder };
  },
  slots: (slot) => ({
    root: slot({
      state: (state, { api }) => ({ order: api.reorder.order(state) }),
      bind: (el) => slideRows(el),
    }),
    row: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, { api, key }) => ({
        "data-map": key,
        "data-moving":
          api.reorder.moving(state, key) && !api.reorder.dragging(state, key)
            ? ""
            : undefined,
        "data-dragging": api.reorder.dragging(state, key) ? "" : undefined,
      }),
      on: {
        // Menu presses arrive through React's portal, and touch drags start only
        // from the handle so the rest of a row still scrolls the page.
        pointerdown: (event, { api, el, key }) => {
          const target = event.target as Element;
          if (
            !el?.contains(target) ||
            target.closest("[data-slot=menu-trigger]")
          ) {
            return;
          }
          if (
            event.pointerType !== "touch" ||
            target.closest("[data-slot=map-order-handle]")
          ) {
            api.reorder.pointerdown(event, key);
          }
        },
      },
      bind: (el, part) => part.api.reorder.bind(el, part),
    }),
    handle: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, { api, key }) => ({
        type: "button",
        "aria-pressed": String(api.reorder.moving(state, key)),
      }),
      on: {
        keydown: (event, { api, key }) => {
          api.reorder.keydown(event, key);
        },
      },
    }),
  }),
});

// Slides each row from where it was drawn to its new place when the order
// changes, like a dnd-kit sortable. Adding or removing rows skips the slide.
// The cells move rather than the row, since createReorder picks the drop
// index from each row's rect and a moving rect makes the order flicker.
function slideRows(body: HTMLElement) {
  let tops = new Map<HTMLElement, number>();
  const slides = new WeakMap<HTMLElement, Animation[]>();
  const view = body.ownerDocument.defaultView;
  const rows = () => [...body.children] as HTMLElement[];
  const measure = () => {
    tops = new Map(rows().map((row) => [row, row.offsetTop]));
  };
  const observer = new MutationObserver(() => {
    const current = rows();
    const moved =
      current.length === tops.size && current.every((row) => tops.has(row));
    if (
      moved &&
      !view?.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const shifts = current.map(
        (row) =>
          defined(tops.get(row)) +
          (row.firstElementChild
            ? new DOMMatrixReadOnly(
                getComputedStyle(row.firstElementChild).transform,
              ).m42
            : 0) -
          row.offsetTop,
      );
      current.forEach((row, index) => {
        for (const slide of slides.get(row) ?? []) slide.cancel();
        const shift = shifts[index];
        if (Math.abs(shift) < 1) return;
        slides.set(
          row,
          [...row.children].map((cell) =>
            cell.animate(
              [{ transform: `translateY(${shift}px)` }, { transform: "none" }],
              { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
            ),
          ),
        );
      });
    }
    measure();
  });
  measure();
  observer.observe(body, { childList: true });
  return () => observer.disconnect();
}

const parts = createParts(mapOrder, {
  root: "tbody",
  row: "tr",
  handle: "button",
});
export const MapOrder = parts.Root;
export const MapOrderRow = parts.Row;
export const MapOrderHandle = parts.Handle;

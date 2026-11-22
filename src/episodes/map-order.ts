"use client";

import {
  createChange,
  createReorder,
  definePrimitive,
  type ChangeDetails,
  type ReorderDraft,
  type ReorderReason,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

type MapOrderOptions = {
  value?: string[];
  onValueChange?: (
    value: string[],
    details: ChangeDetails<ReorderReason>,
  ) => void;
  label?: (id: string) => string | undefined;
};

type MapOrderState = { value: string[]; moving: ReorderDraft | null };

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

const parts = createParts(mapOrder, {
  root: "tbody",
  row: "tr",
  handle: "button",
});
const MapOrder = parts.Root;
const MapOrderRow = parts.Row;
const MapOrderHandle = parts.Handle;

export { MapOrder, MapOrderHandle, MapOrderRow };

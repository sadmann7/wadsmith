import { commentStyle, noLowValueComments } from "./comment-style.ts";
import { noInlineProps } from "./no-inline-props.ts";
import { topDownOrder } from "./top-down-order.ts";

export default {
  meta: { name: "wadsmith" },
  rules: {
    "comment-style": commentStyle,
    "no-inline-props": noInlineProps,
    "no-low-value-comments": noLowValueComments,
    "top-down-order": topDownOrder,
  },
};

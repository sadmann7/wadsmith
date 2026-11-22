import { commentStyle, noLowValueComments } from "./comment-style.ts";
import { noInlineProps } from "./no-inline-props.ts";

export default {
  meta: { name: "wadsmith" },
  rules: {
    "comment-style": commentStyle,
    "no-inline-props": noInlineProps,
    "no-low-value-comments": noLowValueComments,
  },
};

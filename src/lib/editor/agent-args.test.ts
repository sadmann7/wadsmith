import { expect, it } from "vitest";

import { argsListError } from "./agent-actions";

it("explains a step whose args aren't a list", () => {
  expect(argsListError("setMapDetails", { name: "Vault" })).toBe(
    'A step\'s args are a list. Put the arguments of setMapDetails in one, in order or as one object by name, like "args": [{"name":"Vault"}].',
  );
  expect(argsListError("addRoom", "corners")).toMatch(
    /"args": \[\{ "name": value \}\]/,
  );
});

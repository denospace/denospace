import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTreeHandles,
  registerTreeHandle,
  targetTreeHandle,
  unregisterTreeHandle,
} from "./tree_handles.ts";

const handle = (name: string) => ({
  setAllExpanded: () => {
    calls.push(name);
    return true;
  },
});
const calls: string[] = [];

beforeEach(() => {
  clearTreeHandles();
  calls.length = 0;
});

describe("picking the tree a command acts on", () => {
  it("has no answer when nothing is open", () => {
    expect(targetTreeHandle("lhs")).toEqual({ kind: "none" });
  });

  it("prefers the focused panel", () => {
    registerTreeHandle("lhs", handle("lhs"));
    registerTreeHandle("rhs", handle("rhs"));
    const target = targetTreeHandle("rhs");
    expect(target.kind === "ok" && target.slot).toBe("rhs");
  });

  it("falls back to the only tree when focus is somewhere else", () => {
    // What running the command from the palette looks like: the palette is a
    // navigator panel too, so `focusedSlot()` answers "modal" -- a slot with
    // no tree in it.
    registerTreeHandle("lhs", handle("lhs"));
    const target = targetTreeHandle("modal");
    expect(target.kind === "ok" && target.slot).toBe("lhs");
    expect(targetTreeHandle(undefined).kind).toBe("ok");
  });

  it("refuses to guess between two unfocused trees", () => {
    registerTreeHandle("lhs", handle("lhs"));
    registerTreeHandle("rhs", handle("rhs"));
    expect(targetTreeHandle("modal")).toEqual({
      kind: "ambiguous",
      slots: ["lhs", "rhs"],
    });
  });

  it("forgets a panel that unmounted", () => {
    registerTreeHandle("lhs", handle("lhs"));
    registerTreeHandle("rhs", handle("rhs"));
    unregisterTreeHandle("rhs");
    const target = targetTreeHandle("rhs");
    expect(target.kind === "ok" && target.slot).toBe("lhs");
  });
});

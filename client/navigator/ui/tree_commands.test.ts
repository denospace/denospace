import { describe, expect, it, vi } from "vitest";

const writes: [string[], unknown][] = [];
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore: {
    set: (key: string[], value: unknown) => {
      writes.push([key, value]);
      return Promise.resolve();
    },
  },
  editor: { flashNotification: () => Promise.resolve() },
}));

const { createTreeCommands } = await import("./tree_commands.ts");
import { buildTree } from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";

// Two categories, one with a nested folder, so "all" has to mean every level
// and not just the top one.
const rows = [
  { obj: { name: "21  iteam" }, primary: "21  iteam" },
  { obj: { name: "21  iteam\u001f0021=0004" }, primary: "a" },
  { obj: { name: "23  therapy" }, primary: "23  therapy" },
  { obj: { name: "23  therapy\u001fdeeper" }, primary: "deeper" },
  { obj: { name: "23  therapy\u001fdeeper\u001fleaf" }, primary: "leaf" },
] as any[];

const everyFolder = [
  "21  iteam",
  "23  therapy",
  "23  therapy\u001fdeeper",
];

function setup({
  expandAll,
  treeFiltering = false,
  stored = new Set<string>(),
}: {
  expandAll: boolean;
  treeFiltering?: boolean;
  stored?: Set<string>;
}) {
  writes.length = 0;
  let expanded = stored;
  const tree = buildTree(rows, "\u001f", false);
  const cmd = createTreeCommands({
    view: {
      name: "std.signatures",
      meta: { expandAll, hierarchy: { separator: "\u001f" } },
    } as unknown as ActiveView,
    engine: {} as unknown as NavigatorEngine,
    derived: {
      treeFiltering,
      treeDisplay: { tree, effectiveExpanded: new Set<string>() },
    } as unknown as DerivedView,
    refs: {
      input: { current: null },
      expandedDirty: { current: false },
    } as unknown as SharedRefs,
    set: {
      setExpanded: (next: any) => {
        expanded = typeof next === "function" ? next(expanded) : next;
      },
    } as unknown as PanelSetters,
    refresh: () => {},
  });
  return { cmd, expanded: () => [...expanded].sort(), writes };
}

describe("collapsing and expanding the whole tree", () => {
  it("stores every folder to collapse under expandAll, and nothing to expand", () => {
    // `expandAll` inverts the set: it holds what the user shut, so "all shut"
    // is every folder path and "all open" is the empty set.
    const { cmd, expanded } = setup({ expandAll: true });
    expect(cmd.setAllExpanded(false)).toBe(true);
    expect(expanded()).toEqual([...everyFolder].sort());

    expect(cmd.setAllExpanded(true)).toBe(true);
    expect(expanded()).toEqual([]);
  });

  it("stores every folder to expand without expandAll, and nothing to collapse", () => {
    const { cmd, expanded } = setup({ expandAll: false });
    expect(cmd.setAllExpanded(true)).toBe(true);
    expect(expanded()).toEqual([...everyFolder].sort());

    expect(cmd.setAllExpanded(false)).toBe(true);
    expect(expanded()).toEqual([]);
  });

  it("reaches folders at every depth, not just the top level", () => {
    const { cmd, expanded } = setup({ expandAll: false });
    cmd.setAllExpanded(true);
    expect(expanded()).toContain("23  therapy\u001fdeeper");
    // A leaf is not a folder, so it is never in the set.
    expect(expanded()).not.toContain("23  therapy\u001fdeeper\u001fleaf");
  });

  it("persists under the key the expandAll reading uses", () => {
    const { cmd, writes } = setup({ expandAll: true });
    cmd.setAllExpanded(false);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toEqual(["navigator", "std.signatures", "collapsed"]);
    expect([...(writes[0][1] as string[])].sort()).toEqual(
      [...everyFolder].sort(),
    );
  });

  it("refuses while filtering, rather than writing a set nobody can see", () => {
    // Filtering force-expands the pruned tree, so the stored set is not
    // consulted at all: writing one here would only surface later, as a tree
    // that mysteriously collapsed itself when the filter was cleared.
    const stored = new Set(["21  iteam"]);
    const { cmd, expanded, writes } = setup({
      expandAll: true,
      treeFiltering: true,
      stored,
    });
    expect(cmd.setAllExpanded(false)).toBe(false);
    expect(expanded()).toEqual(["21  iteam"]);
    expect(writes).toEqual([]);
  });

  it("refuses when there is no tree to walk", () => {
    writes.length = 0;
    const cmd = createTreeCommands({
      view: {
        name: "std.signatures",
        meta: { expandAll: true, hierarchy: { separator: "\u001f" } },
      } as unknown as ActiveView,
      engine: {} as unknown as NavigatorEngine,
      derived: { treeFiltering: false } as unknown as DerivedView,
      refs: {
        input: { current: null },
        expandedDirty: { current: false },
      } as unknown as SharedRefs,
      set: { setExpanded: () => {} } as unknown as PanelSetters,
      refresh: () => {},
    });
    expect(cmd.setAllExpanded(false)).toBe(false);
    expect(writes).toEqual([]);
  });
});

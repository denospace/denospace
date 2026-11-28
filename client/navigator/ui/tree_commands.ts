import { datastore, editor } from "@silverbulletmd/silverbullet/syscalls";
import {
  allFolderPaths,
  planMove,
  withExpanded,
} from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import { expansionKey } from "./expansion.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";

/**
 * What tree mode does to the tree itself: the expansion set (persisted per
 * view, so a dock comes back the way it was left) and drag-and-drop moves.
 * Split from the rest of the commands because these are the only ones that
 * write structure rather than act on a selection.
 */
export function createTreeCommands({
  view,
  engine,
  derived,
  refs,
  set,
  refresh,
}: {
  view?: ActiveView;
  engine: NavigatorEngine;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
  refresh: () => void;
}) {
  const { expandedDirty, input: inputRef } = refs;
  const { setExpanded } = set;
  const { treeFiltering, treeDisplay } = derived;

  const expandAll = view?.meta.expandAll === true;

  function persistExpanded(next: Set<string>) {
    if (!view) return;
    // A page-scoped tree has nowhere to persist to: its paths are the current
    // page's, so a stored set would arrive on top of a different page's rows.
    const key = expansionKey(view.name, view.meta);
    if (key) void datastore.set(key, [...next]);
  }

  function toggleExpanded(path: string) {
    // Tree rows are drag sources, so they are exempt from the panel-wide
    // mousedown suppression (see NavRoot); a chevron click blurs the input,
    // and this hands it back. A no-op for the keyboard path.
    inputRef.current?.focus();
    // Filtering force-expands every pruned folder; a manual toggle in that
    // state would just be overridden on the next render, so skip it (and the
    // datastore write) rather than have it silently do nothing visible.
    if (treeFiltering) return;
    expandedDirty.current = true;
    setExpanded((prev) => {
      // Membership means "open" under one reading and "closed" under the
      // other, so flipping it is the same gesture either way.
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistExpanded(next);
      return next;
    });
  }

  /**
   * Every folder open, or every folder shut, in one gesture.
   *
   * Membership in the stored set means "shut" under `expandAll` and "open"
   * without it, so one reading's "all open" is the other's "all shut": the
   * empty set when `expand` agrees with the flag, every folder path when it
   * does not. Returns whether it did anything, so a caller outside the panel
   * can say why not.
   */
  function setAllExpanded(expand: boolean): boolean {
    // No focus hand-back, unlike `toggleExpanded`: nothing clicks this. On the
    // `Shift-Arrow` path focus is already in the input, and on the command
    // path the palette's own `close` does `editor.focus()` afterwards -- so a
    // `.focus()` here would be a no-op either way, not a safeguard.
    // A filtered tree is force-expanded to show its matches, so neither set is
    // consulted and this would be invisible -- while still being written to
    // the datastore, to be discovered whenever the filter was next cleared.
    if (treeFiltering || !treeDisplay) return false;
    const next =
      expand === expandAll
        ? new Set<string>()
        : allFolderPaths(treeDisplay.tree);
    expandedDirty.current = true;
    setExpanded(next);
    persistExpanded(next);
    return true;
  }

  function expandPath(path: string) {
    expandedDirty.current = true;
    setExpanded((prev) => {
      const next = withExpanded(prev, [path], expandAll);
      // `withExpanded` only ever adds or only ever removes, so an unchanged
      // size means it was already open.
      if (next.size === prev.size) return prev;
      persistExpanded(next);
      return next;
    });
  }

  /** A completed drag: `targetFolder` is `""` for a drop on the root area. */
  async function moveNode(draggedPath: string, targetFolder: string) {
    // The drag's own mousedown blurred the input (same exemption as above).
    inputRef.current?.focus();
    if (!view || !treeDisplay) return;
    const plan = planMove(
      treeDisplay.tree,
      draggedPath,
      targetFolder,
      view.meta.hierarchy.separator,
    );
    if (plan.kind === "none") return;
    if (plan.kind === "collision") {
      await editor.flashNotification(`${plan.newName} already exists`, "error");
      return;
    }
    try {
      await engine.move(view.name, plan.obj, plan.newName);
    } catch (e: any) {
      await editor.flashNotification(
        `Move failed: ${e?.message ?? e}`,
        "error",
      );
      return;
    }
    // Otherwise a drop on a collapsed folder just makes the row vanish.
    if (targetFolder) expandPath(targetFolder);
    // The rename's file events refresh us anyway; this only makes it prompt.
    refresh();
  }

  return { toggleExpanded, setAllExpanded, expandPath, moveNode };
}

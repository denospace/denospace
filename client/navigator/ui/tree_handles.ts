/**
 * The mounted tree panels, so a command invoked from outside one can still act
 * on it.
 *
 * Needed because the command palette is itself a navigator panel: running
 * `Navigate: Collapse All` from it means focus is in the palette's own filter
 * input, not in the tree, and the tree's keydown handler never sees anything.
 * A panel registers itself here while it is in tree mode and drops out when it
 * unmounts or switches to a view that is not a tree.
 *
 * Keyed by slot rather than by view name: what "the tree" means to someone
 * looking at the screen is the panel in front of them, and the same view can
 * be docked in either sidebar.
 */

export type TreeHandle = {
  /** See `setAllExpanded` in `tree_commands.ts`. */
  setAllExpanded: (expand: boolean) => boolean;
};

export type TreeTarget =
  | { kind: "ok"; slot: string; handle: TreeHandle }
  | { kind: "none" }
  /** Two trees open and neither focused: collapsing a guess is worse than
   * saying so, because the one that collapses is the one off to the side. */
  | { kind: "ambiguous"; slots: string[] };

const handles = new Map<string, TreeHandle>();

export function registerTreeHandle(slot: string, handle: TreeHandle): void {
  handles.set(slot, handle);
}

export function unregisterTreeHandle(slot: string): void {
  handles.delete(slot);
}

/** Test seam: drops every registration. */
export function clearTreeHandles(): void {
  handles.clear();
}

/**
 * The tree panel a command should act on: the focused one if it is a tree, and
 * otherwise the only one open.
 *
 * @param focused the slot holding focus, from `focusedSlot()`.
 */
export function targetTreeHandle(focused?: string): TreeTarget {
  if (focused !== undefined) {
    const handle = handles.get(focused);
    if (handle) return { kind: "ok", slot: focused, handle };
  }
  const slots = [...handles.keys()];
  if (slots.length === 0) return { kind: "none" };
  if (slots.length > 1) return { kind: "ambiguous", slots };
  return { kind: "ok", slot: slots[0], handle: handles.get(slots[0])! };
}

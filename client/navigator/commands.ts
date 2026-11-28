import { editor, events, space } from "@silverbulletmd/silverbullet/syscalls";
import type { CommandHook } from "../plugos/hooks/command.ts";
import { openCommand } from "./navigator.ts";
import { focusedSlot } from "./ui/slots.ts";
import { targetTreeHandle } from "./ui/tree_handles.ts";
import { REVISIONS_CHANGED_EVENT } from "./views/revisions.ts";

/** The built-in navigator views that come with a command of their own. */
export function registerNavigatorCommands(
  hook: CommandHook,
  revisionsEnabled: boolean,
): void {
  hook.registerCommand({
    name: "Navigate: Tree",
    key: ["Ctrl-o", "Ctrl-Shift-o"],
    mac: ["Cmd-o", "Cmd-Shift-o"],
    menu: { location: "view", group: "1_views", order: 4, label: "Tree" },
    run: openCommand("std.spaceTree"),
  });
  // No default key: `Shift-ArrowLeft`/`Shift-ArrowRight` already do this with
  // the tree focused, and a plain chord bound here would never reach these --
  // the global fallback leaves unmodified keys to the focused input. Bind a
  // Ctrl/Cmd chord with `command.update` if you want one.
  hook.registerCommand({
    name: "Navigate: Collapse All",
    run: () => setAllExpandedInTree(false),
  });
  hook.registerCommand({
    name: "Navigate: Expand All",
    run: () => setAllExpandedInTree(true),
  });
  if (revisionsEnabled) {
    hook.registerCommand({
      name: "Revision: Page History",
      requireEditor: "page",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 1,
        label: "Page History",
      },
      run: openCommand("std.pageHistory"),
    });
    hook.registerCommand({
      name: "Revision: Space History",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 2,
        label: "Space History",
      },
      run: openCommand("std.spaceLog"),
    });
    hook.registerCommand({
      name: "Revision: Create snapshot",
      requireMode: "rw",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 3,
        label: "Create Snapshot",
      },
      run: createSnapshot,
    });
  }
}

/**
 * Shut or open every folder of the tree panel on screen.
 *
 * The panel itself is reached through `tree_handles.ts` rather than by key,
 * because running this from the command palette puts focus in the palette --
 * which is a navigator panel too, just not a tree one.
 */
async function setAllExpandedInTree(expand: boolean): Promise<void> {
  const target = targetTreeHandle(focusedSlot());
  if (target.kind === "none") {
    await editor.flashNotification("No tree view is open", "error");
    return;
  }
  if (target.kind === "ambiguous") {
    // Naming them is the useful part: the fix is to click into the one meant,
    // or to press the key there, and that needs knowing which two they are.
    await editor.flashNotification(
      `Two tree views are open (${target.slots.join(", ")}); ` +
        "use Shift-Left in the one you mean",
      "error",
    );
    return;
  }
  if (!target.handle.setAllExpanded(expand)) {
    // The only way it refuses: a filtered tree is force-expanded to show its
    // matches, so this would change nothing visible now and everything later.
    await editor.flashNotification(
      "Clear the filter first -- a filtered tree is expanded to show matches",
      "error",
    );
  }
}

/**
 * Registered whenever revisions are enabled, not only for a space the boot
 * config calls managed: a synced App space is advertised as unmanaged (its
 * history lives on the remote, which may well be managed), so the server's
 * own answer is the only reliable one. An unmanaged space says so.
 */
async function createSnapshot(): Promise<void> {
  let committed: boolean;
  try {
    committed = await space.createRevisionSnapshot();
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return;
  }
  await editor.flashNotification(
    committed ? "Snapshot created" : "Nothing to snapshot",
  );
  await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
}

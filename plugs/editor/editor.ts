import {
  clientStore,
  codeWidget,
  editor,
  system,
} from "@silverbulletmd/silverbullet/syscalls";

// Run on "editor:init"
export async function setEditorMode() {
  // TODO: Remove at some point: temporary upgrade code
  const allSyscalls = await system.listSyscalls();
  const queryLuaObjects = allSyscalls.find(
    (sc) => sc.name === "index.queryLuaObjects",
  );

  if (!queryLuaObjects) {
    await editor.alert(
      "Client needs reloading to update the cache, required syscalls are not available in this version. This message may appear a few times. Reloading now.",
    );
    void editor.reloadUI();
  }

  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  // Only set the darkmode value if it was deliberatly set in the clientstore,
  // otherwise leave it so the client can choose depending on the system
  // settings
  const darkMode = await clientStore.get("darkMode");
  if (darkMode != null) {
    await editor.setUiOption("darkMode", darkMode);
  }
  if (await clientStore.get("monospacePitch")) {
    await editor.setUiOption("monospacePitch", true);
  }
  // Folded is the default, so only a deliberate `false` is restored.
  const foldMetadata = await clientStore.get("foldMetadata");
  if (foldMetadata != null) {
    await editor.setUiOption("foldMetadata", foldMetadata);
  }
  const layout = await clientStore.get("editorLayout");
  if (layout && layout !== "prose") {
    await editor.setUiOption("editorLayout", layout);
    await editor.rebuildEditorState();
  }
  const rawMarkup = await clientStore.get("rawMarkup");
  if (rawMarkup != null) {
    await editor.setUiOption("rawMarkup", rawMarkup);
    await editor.rebuildEditorState();
  }
}

export async function openTagNavigator() {
  await editor.openNavigator("std.tags");
  // The panel focuses its own filter input; false keeps the client from
  // pulling focus straight back to the editor.
  return false;
}

export async function toggleDarkMode() {
  let darkMode = await editor.getUiOption("darkMode");
  darkMode = !darkMode;
  await clientStore.set("darkMode", darkMode);
  await editor.reloadUI();
}

/**
 * `variable-pitch-mode`: prose and the UI in a proportional face or the
 * monospace one. Only the fonts change -- nothing about the layout, the
 * measure or what is rendered -- and code stays monospace either way.
 */
export async function toggleVariablePitch() {
  const monospace = !(await editor.getUiOption("monospacePitch"));
  await clientStore.set("monospacePitch", monospace);
  await editor.setUiOption("monospacePitch", monospace);
  await editor.flashNotification(monospace ? "Monospace" : "Variable pitch");
}

/**
 * Shows or hides the `#+key:` block at the top of a note.
 *
 * Folded, because what it holds -- the title, the signature, the keywords --
 * is already in the top bar, and five lines of it is a lot of the screen to
 * spend on saying so twice. The setting is per device and not per note, so
 * the first line of prose sits at the same height in every note rather than
 * stepping down by however many keywords this one happens to carry.
 */
export async function toggleMetadata() {
  const folded = !(await editor.getUiOption("foldMetadata"));
  await clientStore.set("foldMetadata", folded);
  await editor.setUiOption("foldMetadata", folded);
  await editor.rebuildEditorState();
  await editor.flashNotification(folded ? "Metadata hidden" : "Metadata shown");
}

/**
 * The three layouts, which are good at different things.
 *
 * Prose view puts every marker -- heading stars, list bullets, a keyword's
 * `#+` -- in the left margin, so the text column has one left edge however
 * deep the line sits, and depth is read off the margin and off heading
 * weight. It reads like a page.
 *
 * Outline view is the older arrangement: each level steps in by a fixed
 * amount with a hairline drawn per level crossed, so a deep tree can be read
 * off the left edge at a glance. It reads like notes.
 *
 * Tufte view is the look of the site these notes are published to -- a
 * serif, a narrow measure, a size hierarchy -- with the markup hidden
 * entirely until the caret is on its line. It reads like what it will become.
 */
const views = [
  {
    value: "prose",
    name: "Prose",
    description: "Markers in the margin, one text edge",
  },
  {
    value: "outline",
    name: "Outline",
    description: "A step and a rule per level",
  },
  {
    value: "tufte",
    name: "Tufte",
    description: "The published look: serif, narrow, quiet",
  },
];

export async function switchViewCommand() {
  const current = await editor.getUiOption("editorLayout");
  const choice = (await editor.filterBox(
    "View",
    views.map((view) => ({
      ...view,
      // The one in use leads, so the command is also how you see which it is.
      orderId: view.value === current ? 0 : 1,
    })),
    "How this note is laid out",
  )) as { value: string } | undefined;
  if (!choice || choice.value === current) {
    return;
  }
  await setView(choice.value);
}

/** Steps to the next one, for a key that cycles rather than asks. */
export async function cycleViewCommand() {
  const current = await editor.getUiOption("editorLayout");
  const at = views.findIndex((view) => view.value === current);
  await setView(views[(at + 1) % views.length].value);
}

async function setView(view: string) {
  await clientStore.set("editorLayout", view);
  await editor.setUiOption("editorLayout", view);
  await editor.rebuildEditorState();
  await editor.flashNotification(
    `${views.find((v) => v.value === view)?.name ?? view} view`,
  );
}

export async function toggleRawMarkup() {
  let rawMarkup = await editor.getUiOption("rawMarkup");
  rawMarkup = !rawMarkup;
  await clientStore.set("rawMarkup", rawMarkup);
  await editor.setUiOption("rawMarkup", rawMarkup);
  await editor.rebuildEditorState();
}

export async function centerCursorCommand() {
  const pos = await editor.getCursor();
  await editor.moveCursor(pos, true);
}

export async function moveToPosCommand() {
  let posString = await editor.prompt("Move to position:");
  if (posString === undefined) {
    return;
  }
  posString = posString.trim();
  if (posString === "") {
    void editor.flashNotification("Must provide a position.", "error");
    return;
  }
  const pos = +posString;
  await editor.moveCursor(pos, true);
}

export async function copyRefCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`[[${page}@${pos}]]`);
  await editor.flashNotification("Ref copied to clipboard");
}

export async function copyLinkCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`${await system.getBaseURI()}${page}@${pos}`);
  await editor.flashNotification("Link copied to clipboard");
}

export async function moveToLineCommand() {
  let lineString = await editor.prompt("Move to line (and optionally column):");
  if (lineString === undefined) {
    return;
  }
  lineString = lineString.trim();
  if (lineString === "") {
    void editor.flashNotification("Must provide a line number.", "error");
    return;
  }
  // Two capture groups: line number, then optional column number
  const numberRegex = /^(\d+)(?:[^\d]+(\d+))?/;
  const match = lineString.match(numberRegex);
  if (!match) {
    await editor.flashNotification(
      "Could not parse line number in prompt",
      "error",
    );
    return;
  }
  let column = 1;
  const line = parseInt(match[1], 10);
  if (match[2]) {
    column = parseInt(match[2], 10);
  }
  await editor.moveCursorToLine(line, column, true);
}

export async function customFlashMessage(_def: any, message: string) {
  await editor.flashNotification(message);
}

export async function reloadSystem() {
  await editor.save();
  await editor.reloadConfigAndCommands();
  await codeWidget.refreshAll();
  await editor.flashNotification("System and widgets reloaded!");
}

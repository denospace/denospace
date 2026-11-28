import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { runCommandViaPalette } from "./navigator-ui.ts";

// A forty-category tree used to take forty presses of ArrowLeft to shut, so
// `Shift-ArrowLeft` does the lot -- and the command pair does it from the
// palette, which is the harder case: the palette is a navigator panel too, so
// running a command from it means focus has left the tree entirely.

const TREE_VIEW = `# Collapse test

\`\`\`space-lua
view.define {
  name = "collapseTest",
  title = "Collapse Test",
  command = "Navigator: Collapse Test",
  dock = "lhs",
  supportedDocks = { "lhs", "rhs", "modal" },
  presentation = {
    mode = "tree",
    hierarchy = { field = "name", separator = "/" },
    -- The flag under test: membership in the stored set means "shut" here,
    -- the opposite of what it means without it.
    expandAll = true,
    row = {
      primary = function(obj) return obj.name end,
      label = function(obj) return obj.name end,
    },
  },
  source = function()
    return {
      { name = "Alpha", ref = "index" },
      { name = "Alpha/one", ref = "index" },
      { name = "Alpha/two", ref = "index" },
      { name = "Beta", ref = "index" },
      { name = "Beta/deep", ref = "index" },
      { name = "Beta/deep/leaf", ref = "index" },
    }
  end,
  onSelect = function() end,
}
\`\`\`
`;

const lhs = (page: Page) => page.locator(".sb-nav-root-lhs");
const rows = (page: Page) => lhs(page).locator("[data-path]");

/** The rows on screen, by their path, in display order. */
function paths(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.path ?? ""),
  );
}

const ALL = [
  "Alpha",
  "Alpha/one",
  "Alpha/two",
  "Beta",
  "Beta/deep",
  "Beta/deep/leaf",
];
const TOP = ["Alpha", "Beta"];

async function openTree(page: Page) {
  await runCommandViaPalette(page, "Navigator: Collapse Test");
  await expect(lhs(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => paths(page), { timeout: 20_000 }).toEqual(ALL);
}

/** Reopens the dock without asserting it comes back expanded. */
async function reopenTree(page: Page) {
  await runCommandViaPalette(page, "Navigator: Collapse Test");
  await expect(lhs(page)).toBeVisible({ timeout: 20_000 });
}

/**
 * The tree, with its filter box holding focus.
 *
 * Opening a sidebar dock from the palette leaves focus undecided: the
 * activation focuses the panel's input and the palette's own close does
 * `editor.focus()`, with no fixed order between them. A key test has to say
 * which it meant, or it passes or fails on that race.
 */
async function openTreeFocused(page: Page) {
  await openTree(page);
  await lhs(page).locator("input.sb-nav-input").click();
  await expect(lhs(page).locator("input.sb-nav-input")).toBeFocused();
}

test.use({
  spaceFiles: { "index.md": "Welcome\n", "Collapse Test.md": TREE_VIEW },
});

test("Shift-ArrowLeft shuts the whole tree and Shift-ArrowRight opens it", async ({
  sbPage,
}) => {
  await openTreeFocused(sbPage);

  await sbPage.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => paths(sbPage), { timeout: 10_000 }).toEqual(TOP);

  await sbPage.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => paths(sbPage), { timeout: 10_000 }).toEqual(ALL);
});

test("what it collapsed is still collapsed next time", async ({ sbPage }) => {
  // Through a dock close and reopen rather than a full page load: the
  // persisting write is fire-and-forget, and reloading immediately races it to
  // the server. A reopen goes through the same `createActivate` restore -- the
  // one that used to discard the whole stored set under `expandAll` -- which
  // is what this is here to hold.
  await openTreeFocused(sbPage);
  await sbPage.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => paths(sbPage), { timeout: 10_000 }).toEqual(TOP);

  await lhs(sbPage).locator(".sb-nav-close").click();
  await expect(sbPage.locator("#sb-main .sb-nav-root-lhs")).toBeHidden();

  await reopenTree(sbPage);
  await expect.poll(() => paths(sbPage), { timeout: 20_000 }).toEqual(TOP);
});

test("Navigate: Collapse All reaches the tree from the command palette", async ({
  sbPage,
}) => {
  // The case the handle registry exists for: by the time the command runs,
  // focus is in the palette's input and the tree's keydown handler is out of
  // the picture entirely.
  await openTree(sbPage);
  await runCommandViaPalette(sbPage, "Navigate: Collapse All");
  await expect.poll(() => paths(sbPage), { timeout: 10_000 }).toEqual(TOP);

  await runCommandViaPalette(sbPage, "Navigate: Expand All");
  await expect.poll(() => paths(sbPage), { timeout: 10_000 }).toEqual(ALL);
});

test("with no tree open the command says so rather than failing silently", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Collapse All");
  await expect(sbPage.locator(".sb-notification-error")).toContainText(
    /no tree view is open/i,
    { timeout: 20_000 },
  );
});

test("a filtered tree is left alone, with the reason given", async ({
  sbPage,
}) => {
  // Filtering force-expands the pruned tree to show its matches, so neither
  // reading of the stored set is consulted: a write here would change nothing
  // now and surprise whoever next cleared the filter.
  await openTreeFocused(sbPage);
  await lhs(sbPage).locator("input.sb-nav-input").fill("deep");
  await expect
    .poll(() => paths(sbPage), { timeout: 10_000 })
    .toEqual(["Beta", "Beta/deep", "Beta/deep/leaf"]);

  await sbPage.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(() => paths(sbPage), { timeout: 5_000 })
    .toEqual(["Beta", "Beta/deep", "Beta/deep/leaf"]);

  await runCommandViaPalette(sbPage, "Navigate: Collapse All");
  await expect(sbPage.locator(".sb-notification-error")).toContainText(
    /clear the filter first/i,
    { timeout: 20_000 },
  );
});

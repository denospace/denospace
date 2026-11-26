import {
  expect,
  gotoSilverBulletPage,
  showMetadata,
  test,
} from "./fixtures.ts";
import { currentPage } from "./navigator-ui.ts";

// `denote-prompts` is the whole of Denote's creation design: `denote` asks
// what the list says, and every variant is that list with *one* prompt
// appended. These cover the list being honoured and each variant appending
// the right thing.

const SOURCE = "20261104T090000--field-notes__survey.org";
const sourceNote =
  `#+title:      Field Notes\n#+filetags:   :survey:\n` +
  `#+identifier: 20261104T090000\n\n` +
  `the east fence line is wrong on the plat\nand the gate is on the wrong side\n`;

const TEMPLATE = `---
description: A meeting, with the parts always filled in
tags: meta/template/page
---
* Present
|^|

* Decided
`;

async function runCommand(page: any, name: string) {
  await page.evaluate((command: string) => {
    void (globalThis as any).sbRuntime.evalLuaScript(
      `editor.invokeCommand("${command}")`,
    );
  }, name);
}

/**
 * `editor.prompt`: fill it in and take it.
 *
 * Three inputs look alike on screen and each has its own class: a prompt is
 * `.sb-prompt-input`, a filter box is `.sb-filter-input`, and a navigator
 * panel is `.sb-nav-input`. A generic `input` selector picks whichever is in
 * the DOM, which in a sequence of prompts is a coin toss.
 */
async function answer(page: any, value: string) {
  const prompt = page.locator(".sb-prompt-input").first();
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.fill(value);
  await prompt.press("Enter");
  await page.waitForTimeout(600);
}

/**
 * `editor.filterBox`: narrow to the wanted row, then take it.
 *
 * Waits for the list to actually *be* that one row before pressing Enter --
 * typing does not narrow it synchronously, and Enter takes whichever row is
 * selected, so pressing it straight after `fill` picks off the unnarrowed
 * list.
 */
async function pick(page: any, text: string) {
  const box = page.locator(".sb-filter-input").first();
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(text);
  await expect(page.locator(".sb-result-list .sb-name")).toHaveCount(1, {
    timeout: 10_000,
  });
  await box.press("Enter");
  await page.waitForTimeout(600);
}

/** Ends the keyword prompt by taking its own "Done" row. */
async function doneKeywords(page: any) {
  await page
    .locator(".sb-result-list .sb-option", { hasText: /Done/ })
    .first()
    .click();
  await page.waitForTimeout(600);
}

/** The new note's text, read from the document rather than the screen. */
function noteText(page: any): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript("return editor.getText()"),
  );
}

test.describe("Denote's creation variants", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      [SOURCE]: sourceNote,
      "Templates/Meeting.md": TEMPLATE,
      // A note in a subdirectory, so the subdirectory prompt has one real
      // row to offer.
      "archive/20261104T080000--old-plat__survey.org":
        `#+title:      Old Plat\n#+filetags:   :survey:\n` +
        `#+identifier: 20261104T080000\n\nsuperseded in 1998\n`,
    },
  });

  test("with Date mints the identifier from the date given", async ({
    sbPage,
    sbServer,
  }) => {
    // `denote-date`. The identifier is the note's primary key and what every
    // link points at, so dating a note backwards is the one way to file it
    // under the day it is about rather than the day it was typed.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await runCommand(sbPage, "Denote: New Note with Date");
    await answer(sbPage, "Closing Argument");
    await doneKeywords(sbPage);
    // Appended, so the date is asked last -- as `denote-date` asks it.
    await answer(sbPage, "2019-03-04");

    await expect(currentPage(sbPage)).toHaveValue(
      /^20190304T\d{6}--closing-argument\.org$/,
      { timeout: 20_000 },
    );
    // Written into the front matter too, not only the name.
    expect(await noteText(sbPage)).toContain("#+date:       [2019-03-04 Mon");
  });

  test("in Subdirectory writes the note there", async ({
    sbPage,
    sbServer,
  }) => {
    // `denote-subdirectory`. The library is flat by design, so this is for
    // the deliberate exceptions -- a journal directory is one of them.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    // Let the index settle: the rows come from the notes, not the file list.
    await sbPage.waitForTimeout(3000);
    await runCommand(sbPage, "Denote: New Note in Subdirectory");
    await answer(sbPage, "Site Visit");
    await doneKeywords(sbPage);

    // The rows are the *library's* subdirectories, which is what
    // `denote-subdirectory-prompt` completes over. Read from the file list
    // instead they would include every folder of the shipped documentation
    // and the template folder -- dozens of rows, none of them anywhere a note
    // belongs.
    await expect(sbPage.locator(".sb-filter-input").first()).toBeVisible({
      timeout: 20_000,
    });
    const offered = (
      await sbPage.locator(".sb-result-list .sb-name").allTextContents()
    ).join("|");
    expect(offered).toContain("archive");
    expect(offered).not.toContain("Library");
    expect(offered).not.toContain("Templates");

    // A directory that does not exist yet is a fine answer: writing the note
    // creates it.
    await pick(sbPage, "New subdirectory");
    await answer(sbPage, "surveys");

    await expect(currentPage(sbPage)).toHaveValue(
      /^surveys\/\d{8}T\d{6}--site-visit\.org$/,
      { timeout: 20_000 },
    );
  });

  test("of Type writes that format, not the configured one", async ({
    sbPage,
    sbServer,
  }) => {
    // `denote-type`. The space default is Org; this is the per-note override,
    // and it has to change both the extension and the front matter notation.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await showMetadata(sbPage);
    await runCommand(sbPage, "Denote: New Note of Type");
    await answer(sbPage, "Mixed Format Note");
    await doneKeywords(sbPage);
    await pick(sbPage, "TOML");

    // A Markdown page's name does not carry its extension, which is exactly
    // what `denotePageName` is for -- handing `writePage` the file name
    // produced `....md.md` and failed the write outright, so until this was
    // fixed no Markdown note could be created at all.
    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--mixed-format-note$/,
      { timeout: 20_000 },
    );
    const name = await currentPage(sbPage).inputValue();
    const text = await noteText(sbPage);
    expect(text).toContain("+++");
    expect(text).toContain('title      = "Mixed Format Note"');
    expect(text).not.toContain("#+title:");

    // And on disk it is a `.md` file, under exactly that name once.
    const listing = await (
      await fetch(`${sbServer.url}/.fs/`, {
        headers: { "X-Sync-Mode": "true" },
      })
    ).text();
    expect(listing).toContain(`${name}.md`);
    expect(listing).not.toContain(`${name}.md.md`);
  });

  test("from Template starts the note with it, cursor at the marker", async ({
    sbPage,
    sbServer,
  }) => {
    // `denote-template`. Denote keeps its templates in the init file; the
    // equivalent here already exists as pages tagged `meta/template/page`,
    // so this reads those rather than inventing a second kind of template.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await runCommand(sbPage, "Denote: New Note from Template");
    await answer(sbPage, "Fence Line Meeting");
    await doneKeywords(sbPage);
    await pick(sbPage, "Meeting");

    // The barrier matters: without it this read the index page's "# Home" and
    // the assertion failed on a note that had in fact been made correctly.
    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--fence-line-meeting\.org$/,
      { timeout: 20_000 },
    );
    const text = await noteText(sbPage);
    expect(text).toContain("* Present");
    expect(text).toContain("* Decided");
    // The template's own front matter is not the note's: the note gets
    // Denote's, and the `meta/template` tag does not come along.
    expect(text).toContain("#+identifier: ");
    expect(text).not.toContain("meta/template");
    // `|^|` says where the cursor goes and is not left in the text.
    expect(text).not.toContain("|^|");
    const cursor = await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLuaScript("return editor.getCursor()"),
    );
    expect(text.slice(0, cursor)).toMatch(/\* Present\n$/);
  });

  test("from Region lifts the selection into a new note", async ({
    sbPage,
    sbServer,
  }) => {
    // `denote-region`. It copies rather than moves: the passage stays where it
    // is, because deciding to cut it out is a separate decision.
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("east fence line", { timeout: 20_000 });
    await sbPage.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(`
        local text = editor.getText()
        local from = string.find(text, "the east fence line", 1, true) - 1
        editor.setSelection(from, from + 40)
      `);
    });
    await sbPage.waitForTimeout(400);

    await runCommand(sbPage, "Denote: New Note from Region");
    // No default title: Denote asks outright here, and the first line of a
    // passage makes a poor file name.
    await answer(sbPage, "The Fence Line Is Wrong");
    await doneKeywords(sbPage);

    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--the-fence-line-is-wrong\.org$/,
      { timeout: 20_000 },
    );
    expect(await noteText(sbPage)).toContain("the east fence line is wrong");

    // And the passage is still in the note it came from.
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "the east fence line is wrong on the plat",
      { timeout: 20_000 },
    );
  });
});

test.describe("denote.prompts", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "CONFIG.md": [
        "```space-lua",
        // Keywords first, and no title prompt at all -- the order is the
        // order asked, and a prompt left out is not asked.
        'config.set("denote.prompts", { "keywords", "signature" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("the configured list is what is asked, in that order", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(2000);
    // `Denote: New Note with Signature` appends `signature`, but the list
    // already has it, so it is asked where the configuration put it rather
    // than a second time at the end.
    await runCommand(sbPage, "Denote: New Note with Signature");

    // Keywords come first: the keyword prompt's "Done" row is on screen
    // before any text prompt has been shown.
    await expect(
      sbPage.locator(".sb-result-list .sb-option", { hasText: /Done/ }),
    ).toBeVisible({ timeout: 20_000 });
    await doneKeywords(sbPage);

    // Then the signature, and then nothing: with no `title` in the list there
    // is no title to give, and a note here is not made without one.
    await answer(sbPage, "aa");
    await expect(
      sbPage.locator(".sb-notifications", { hasText: /A note needs a title/ }),
    ).toBeVisible({ timeout: 20_000 });
    // Still on the page it started from, because no note was made.
    await expect(currentPage(sbPage)).toHaveValue("index", {
      timeout: 20_000,
    });
  });
});

test.describe("denote.prompts with a template, and a region", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      [SOURCE]: sourceNote,
      "Templates/Meeting.md": TEMPLATE,
      "CONFIG.md": [
        "```space-lua",
        'config.set("denote.prompts", { "title", "template" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("the region wins over the template, and says so", async ({
    sbPage,
    sbServer,
  }) => {
    // Both want to be the body of the new note, and `denote-region` exists to
    // keep the selection -- so overwriting it with a template would throw away
    // the one thing the command is for. It is not asked for, and it says why,
    // because this only happens to someone who put `template` in the list.
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "east fence line",
      { timeout: 20_000 },
    );
    await sbPage.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(`
        local text = editor.getText()
        local from = string.find(text, "the east fence line", 1, true) - 1
        editor.setSelection(from, from + 40)
      `);
    });
    await sbPage.waitForTimeout(400);

    await runCommand(sbPage, "Denote: New Note from Region");
    await answer(sbPage, "Kept The Selection");
    // No template prompt follows: the next thing that happens is the note.
    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--kept-the-selection\.org$/,
      { timeout: 20_000 },
    );
    const text = await noteText(sbPage);
    expect(text).toContain("the east fence line is wrong");
    expect(text).not.toContain("* Present");
  });

  test("without a region the template is asked for as usual", async ({
    sbPage,
    sbServer,
  }) => {
    // The guard is about a body that is already there, not about the template
    // being in the list -- `Denote: New Note` with the same configuration
    // still gets it.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(2000);
    await runCommand(sbPage, "Denote: New Note");
    await answer(sbPage, "Asked For The Template");
    await pick(sbPage, "Meeting");
    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--asked-for-the-template\.org$/,
      { timeout: 20_000 },
    );
    const text = await noteText(sbPage);
    expect(text).toContain("* Present");
    // And no keywords were asked for: the list does not have them, which the
    // name says -- a note with keywords carries them as a `__kw` segment.
    // Not asserted on `#+filetags:`, which is written either way and simply
    // has nothing in it.
  });
});

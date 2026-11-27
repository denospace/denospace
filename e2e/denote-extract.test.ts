import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";
import { currentPage } from "./navigator-ui.ts";

// `denote-org-extract-org-subtree`: the heading names the note, its tags are
// the keywords, a CLOSED or DATE stamp is the date, and only what the heading
// leaves unsaid is asked for. These drive the whole thing in a real client,
// because what it reads off the heading decides which prompts appear -- and a
// prompt that appears when it should not is a test that hangs, which is the
// clearest possible signal.

const SOURCE = "20261104T090000--case-file__eviction_notes.org";
const sourceNote = `#+title:      Case File
#+filetags:   :eviction:notes:
#+identifier: 20261104T090000

Opening paragraph that stays put.

* DONE Filed the motion :court:filing:
CLOSED: [2024-03-04 Mon 09:30]
Took it to the clerk at nine.

** The exhibits
Three photographs and the lease.

* Still to do
Serve the notice.
`;

async function runCommand(page: any, name: string) {
  await page.evaluate((command: string) => {
    void (globalThis as any).sbRuntime.evalLuaScript(
      `editor.invokeCommand("${command}")`,
    );
  }, name);
}

/** Puts the cursor on the first occurrence of `needle`. */
async function cursorAt(page: any, needle: string) {
  await page.evaluate((text: string) => {
    void (globalThis as any).sbRuntime.evalLuaScript(`
      local at = string.find(editor.getText(), ${JSON.stringify(text)}, 1, true)
      if at ~= nil then editor.moveCursor(at - 1) end
    `);
  }, needle);
  await page.waitForTimeout(300);
}

/** Selects the range covering `needle`. */
async function select(page: any, needle: string) {
  await page.evaluate((text: string) => {
    void (globalThis as any).sbRuntime.evalLuaScript(`
      local at = string.find(editor.getText(), ${JSON.stringify(text)}, 1, true)
      if at ~= nil then
        editor.setSelection(at - 1, at - 1 + ${text.length})
      end
    `);
  }, needle);
  await page.waitForTimeout(300);
}

/** The open page's text, read from the document rather than the screen. */
function noteText(page: any): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript("return editor.getText()"),
  );
}

/** A file's bytes, straight off the server. */
async function fileText(server: any, path: string): Promise<string> {
  const response = await fetch(`${server.url}/.fs/${path}`, {
    headers: { "X-Sync-Mode": "true" },
  });
  return response.ok ? await response.text() : "";
}

async function answer(page: any, value: string) {
  const prompt = page.locator(".sb-prompt-input").first();
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.fill(value);
  await prompt.press("Enter");
  await page.waitForTimeout(600);
}

test.describe("Note: Extract", () => {
  test.use({
    spaceFiles: { "index.md": "# Home\n", [SOURCE]: sourceNote },
  });

  test("a heading that says everything is extracted without a prompt", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await cursorAt(sbPage, "Took it to the clerk");
    await runCommand(sbPage, "Note: Extract");

    // The identifier comes from the CLOSED stamp, the title from the heading
    // with its TODO keyword and tags stripped, and the keywords from the
    // tags. Nothing was typed, so if any of those had been missed this would
    // be sitting on a prompt instead.
    await expect(currentPage(sbPage)).toHaveValue(
      "20240304T093000--filed-the-motion__court_filing.org",
      { timeout: 20_000 },
    );

    const text = await noteText(sbPage);
    expect(text).toContain("#+title:      Filed the motion");
    expect(text).toContain("#+filetags:   :court:filing:");
    expect(text).toContain("#+date:       [2024-03-04 Mon 09:30]");
    // The whole subtree came along, and the subheading was promoted: Denote
    // takes only the text above it, which would have deleted the exhibits
    // from the source without writing them anywhere.
    expect(text).toContain("Took it to the clerk at nine.");
    expect(text).toContain("* The exhibits");
    expect(text).toContain("Three photographs and the lease.");
    expect(text).not.toContain("** The exhibits");
  });

  test("the source keeps a link where the subtree was", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await cursorAt(sbPage, "Took it to the clerk");
    await runCommand(sbPage, "Note: Extract");
    await expect(currentPage(sbPage)).toHaveValue(
      "20240304T093000--filed-the-motion__court_filing.org",
      { timeout: 20_000 },
    );

    // Polls the file rather than the editor: the source was edited and then
    // navigated away from, and the save is what makes the edit real.
    const source = () => fileText(sbServer, SOURCE);
    await expect
      .poll(source, { timeout: 20_000 })
      .toContain("[[denote:20240304T093000][Filed the motion]]");

    const text = await source();
    // Gone from the source, so this was a move.
    expect(text).not.toContain("Took it to the clerk");
    expect(text).not.toContain("The exhibits");
    // The section around it is untouched: the paragraph above, the heading
    // below, and the blank lines that separated them.
    expect(text).toContain("Opening paragraph that stays put.");
    expect(text).toContain("* Still to do");
    expect(text).toContain(
      "[[denote:20240304T093000][Filed the motion]]\n\n* Still to do",
    );
  });

  test("a heading with no tags inherits the note's own", async ({
    sbPage,
    sbServer,
  }) => {
    // Org's file tags are inherited by its headings, so Denote treats a
    // tagless heading as carrying the file's -- and asks for keywords only
    // when neither has any.
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await cursorAt(sbPage, "Serve the notice");
    await runCommand(sbPage, "Note: Extract");

    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--still-to-do__eviction_notes\.org$/,
      { timeout: 20_000 },
    );
    expect(await noteText(sbPage)).toContain("#+filetags:   :eviction:notes:");
  });

  test("with a selection the title is asked for, since a passage has none", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await select(sbPage, "Opening paragraph that stays put.");
    await runCommand(sbPage, "Note: Extract");
    // No heading in the selection, so there is nothing to name it with.
    await answer(sbPage, "Opening Paragraph");

    await expect(currentPage(sbPage)).toHaveValue(
      /^\d{8}T\d{6}--opening-paragraph__eviction_notes\.org$/,
      { timeout: 20_000 },
    );
    expect(await noteText(sbPage)).toContain(
      "Opening paragraph that stays put.",
    );

    const source = () => fileText(sbServer, SOURCE);
    await expect.poll(source, { timeout: 20_000 }).toContain("[[denote:");
    expect(await source()).not.toContain("Opening paragraph that stays put.");
  });

  test("the cursor above the first heading is refused, not guessed at", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, SOURCE);
    await cursorAt(sbPage, "#+title:");
    await runCommand(sbPage, "Note: Extract");

    // Still on the same page, with the front matter intact: the one case
    // Denote also refuses.
    await expect(sbPage.locator(".sb-notification-error")).toContainText(
      /cursor under a heading/i,
      { timeout: 20_000 },
    );
    await expect(currentPage(sbPage)).toHaveValue(SOURCE);
    expect(await noteText(sbPage)).toContain("#+title:      Case File");
  });
});

import { expect, gotoSilverBulletPage, type Page, test } from "./fixtures.ts";

/**
 * A Denote note carries its title, identifier, signature and keywords in a
 * `#+key:` block at the top, and the top bar already shows the parts of it
 * anyone reads. Folded away, that block costs one line instead of five --
 * and, because the setting is per device rather than per note, the same one
 * line in every note, so the prose always begins at the same height.
 */

const SHORT = "20261115T090000==21=04--a-short-head__one.org";
const LONG = "20261116T090000==21=05--a-long-head__one_two_three_four.org";
const STUB = "20261118T090000==21=07--a-stub__one.org";

test.describe("Folding a note's metadata", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      [SHORT]: `#+title:      A Short Head
#+filetags:   :one:
#+identifier: 20261115T090000

Prose begins here.
`,
      [LONG]: `#+title:      A Long Head
#+filetags:   :one:two:three:four:
#+identifier: 20261116T090000
#+signature:  21=05
#+date:       [2026-11-16]

Prose begins here.
`,
      [STUB]: `#+title:      A Stub
#+filetags:   :one:
#+identifier: 20261118T090000

`,
    },
  });

  const state = (page: Page) =>
    page.evaluate(() => {
      const lines = [...document.querySelectorAll("#sb-editor .cm-line")];
      const prose = lines.find((line) =>
        (line.textContent ?? "").startsWith("Prose begins"),
      );
      return {
        // Rounded: the point is that two notes agree, not the exact pixel.
        proseTop: prose ? Math.round(prose.getBoundingClientRect().top) : null,
        folded: !!document.querySelector("#sb-editor .sb-metadata-fold"),
        keysShown: lines.filter((line) =>
          (line.textContent ?? "").startsWith("#+"),
        ).length,
      };
    });

  const open = async (page: Page, server: any, name: string) => {
    await gotoSilverBulletPage(page, server, name);
    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "Prose begins here.",
      { timeout: 20_000 },
    );
  };

  const toggle = (page: Page) =>
    page.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Editor: Toggle Metadata")`,
      );
    });

  test("hides the block, and puts every note's prose at one height", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, SHORT);
    const short = await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true, keysShown: 0 })
      .then(() => state(sbPage));

    // Five `#+` lines rather than three, and it has to make no difference.
    await open(sbPage, sbServer, LONG);
    const long = await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true, keysShown: 0 })
      .then(() => state(sbPage));

    expect(long.proseTop).toBe(short.proseTop);
  });

  test("the toggle shows it again, and keeps saying so on the next note", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, SHORT);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true });

    await toggle(sbPage);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: false, keysShown: 3 });

    // Per device, not per note: the setting follows the reader to the next
    // note rather than being re-made there.
    await open(sbPage, sbServer, LONG);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: false, keysShown: 5 });

    await toggle(sbPage);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true, keysShown: 0 });
  });

  test("keys at the top of a note cannot reach the hidden block", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, SHORT);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true });

    // The block itself, rather than the whole document: TAB on a visible
    // empty line is meant to indent, and that is not what is being asked
    // about here.
    const head = () =>
      sbPage.evaluate(() => {
        const view = (globalThis as any).client.editorView;
        return {
          lines: view.state.doc.toString().split("\n").slice(0, 4),
          // Where the caret ended up, against the end of the hidden block.
          caret: view.state.selection.main.head,
          blockEnd: view.state.doc.line(4).to,
        };
      });
    const before = await head();

    // Clicking at the top of the note puts the caret on the first line,
    // which is the folded one, and TAB there is `org-cycle` -- which found
    // the fold it was standing in and opened it. So TAB at the top of a
    // note edited the metadata.
    const box = (await sbPage.locator("#sb-editor .cm-content").boundingBox())!;
    await sbPage.mouse.click(box.x + 40, box.y + 2);
    await sbPage.keyboard.press("Home");
    await sbPage.keyboard.press("Tab");
    await sbPage.waitForTimeout(300);

    const after = await head();
    expect(after.lines).toEqual(before.lines);
    // And the caret was never in there to begin with.
    expect(after.caret).toBeGreaterThan(after.blockEnd);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true, keysShown: 0 });
  });

  test("a note with nothing written in it yet is still writable", async ({
    sbPage,
    sbServer,
  }) => {
    // What a note is for its first few seconds. Its one empty line is the
    // whole of it, and the caret has to land there rather than among the
    // keywords above -- otherwise the first thing typed into a new note
    // goes into its title.
    await gotoSilverBulletPage(sbPage, sbServer, STUB);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true, keysShown: 0 });

    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.keyboard.type("First words.");
    await expect
      .poll(
        () =>
          sbPage.evaluate(() =>
            (globalThis as any).client.editorView.state.doc.toString(),
          ),
        { timeout: 15_000 },
      )
      .toBe(
        "#+title:      A Stub\n#+filetags:   :one:\n" +
          "#+identifier: 20261118T090000\n\nFirst words.",
      );
  });

  test("the cursor is taken out of the block, not left inside it", async ({
    sbPage,
    sbServer,
  }) => {
    // A page opens with the cursor at position 0, which is inside the block.
    // Left there, the first keystroke would go into hidden text.
    await open(sbPage, sbServer, SHORT);
    await expect
      .poll(() => state(sbPage), { timeout: 15_000 })
      .toMatchObject({ folded: true });

    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.keyboard.press("Home");
    await sbPage.keyboard.type("X");
    const text = await sbPage.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString(),
    );
    expect(text).toContain("#+title:      A Short Head");
    expect(text).not.toContain("X#+");
  });
});

import { expect, gotoSilverBulletPage, type Page, test } from "./fixtures.ts";
import { currentPage } from "./navigator-ui.ts";

/**
 * Renaming a note must not empty the linked mentions of the notes that link
 * to it.
 *
 * A Denote link addresses an identifier, which a rename never changes, so
 * nothing about the link itself needs rewriting. The index is the part that
 * moves: a relation records the page name the link *resolved* to, so every
 * page linking to the renamed one has to be indexed again. That is what
 * `invalidate.ts` arranges, and it was queueing those pages by name with an
 * `.md` glued on -- which for an Org page, whose name already carries its
 * extension, produced `...note.org.md`. The path still resolved back to the
 * right page, so the file was read and re-indexed; but the parser is chosen
 * by extension, so it was parsed as Markdown, where an Org link is not a
 * link. Its relations were cleared on the way in and none written on the way
 * out, and they stayed gone until a full reindex.
 */

const org = (id: string, title: string, body: string) =>
  `#+title:      ${title}
#+date:       [2025-01-20 Mon 10:00]
#+filetags:   :character:
#+identifier: ${id}

${body}`;

const TARGET = "20250101T100000--cherise-green__character.org";
const LINKER = "20250120T090000--site-notes__character.org";
const RENAMED = "20250101T100000--cherise-greene__character.org";

test.describe("Mentions survive a rename", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Denote\n",
      [TARGET]: org("20250101T100000", "Cherise Green", "Runs the clinic.\n"),
      [LINKER]: org(
        "20250120T090000",
        "Site notes",
        "Walked with [[denote:20250101T100000][Cherise]] today.\n",
      ),
    },
  });

  /** Where each denote link resolves, which is what the mentions panel reads. */
  const relations = (page: Page) =>
    page.evaluate(() =>
      (globalThis as any).sbRuntime.evalLuaScript(`
        local out = {}
        for _, r in ipairs(query[[
          from r = index.relations() where r.kind == "denote-link" select r
        ]]) do
          table.insert(out, r.page .. " -> " .. tostring(r.to))
        end
        table.sort(out)
        return table.concat(out, " | ")
      `),
    );

  test("retitling in the front matter keeps them, pointed at the new name", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, TARGET);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Runs the clinic",
      { timeout: 20_000 },
    );
    await expect
      .poll(() => relations(sbPage), { timeout: 30_000 })
      .toBe(`${LINKER} -> ${TARGET}`);

    // Editing the title is what triggers the rename; the file name follows
    // the front matter.
    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const text = view.state.doc.toString();
      const at = text.indexOf("Cherise Green");
      view.dispatch({
        changes: {
          from: at,
          to: at + "Cherise Green".length,
          insert: "Cherise Greene",
        },
      });
    });
    await expect
      .poll(() => currentPage(sbPage).inputValue(), { timeout: 30_000 })
      .toBe(RENAMED);

    // The link still says the same identifier -- it is the index that had to
    // move, and it did, rather than being emptied.
    await expect
      .poll(() => relations(sbPage), { timeout: 30_000 })
      .toBe(`${LINKER} -> ${RENAMED}`);
    expect(
      await sbPage.evaluate(() =>
        (globalThis as any).sbRuntime.evalLuaScript(
          `return space.readPage("20250120T090000--site-notes__character.org")`,
        ),
      ),
    ).toContain("[[denote:20250101T100000][Cherise]]");
  });
});

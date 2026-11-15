import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";
import { currentPage } from "./navigator-ui.ts";

// A Denote file name runs four facts together with `==`, `--` and `__` so a
// plain-text library stays sortable. The top bar has room to lay them out --
// without giving up the one thing the bar does, which is rename the file.
const NOTE = `#+title:      Acorn Medic
#+filetags:   :likenow:mission:
#+identifier: 20260706T090036
#+signature:  25=00

Body.
`;
const NAME = "20260706T090036==25=00--acorn-medic__likenow_mission.org";
const PLAIN = "Notes.md";

test.describe("The page name in the top bar", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      [NAME]: NOTE,
      [PLAIN]: "# Notes\n\nPlain markdown.\n",
    },
  });

  const parts = (page: any) =>
    page.evaluate(() => {
      const q = (s: string) =>
        document.querySelector(`#sb-current-page ${s}`)?.textContent ?? null;
      return {
        title: q(".sb-dn-title"),
        signature: q(".sb-dn-signature"),
        // Laid out right to left so the keywords drop before the title does,
        // so position is what says what order they read in.
        keywords: [
          ...document.querySelectorAll("#sb-current-page .sb-dn-keyword"),
        ]
          .sort(
            (a, b) =>
              a.getBoundingClientRect().left - b.getBoundingClientRect().left,
          )
          .map((el) => el.textContent),
      };
    });

  test("shows title, signature and keywords instead of the file name", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body.",
      { timeout: 20_000 },
    );
    await expect
      .poll(() => parts(sbPage), { timeout: 15_000 })
      .toEqual({
        title: "acorn medic",
        signature: "25=00",
        keywords: ["likenow", "mission"],
      });

    // The identifier is not shown at all. A journal entry is titled by its
    // day already, and on anything else the stamp is the note's identity
    // rather than something to read.
    await expect(
      sbPage.locator("#sb-current-page .sb-dn-identifier"),
    ).toHaveCount(0);
  });

  test("the browser tab is called by the title, not the file name", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body.",
      { timeout: 20_000 },
    );
    // From the front matter, so it keeps its capitals -- the file name's own
    // title is a slug, and `25=00--acorn-medic__likenow_mission.org` says
    // nothing useful in the space a tab has.
    await expect
      .poll(() => sbPage.title(), { timeout: 15_000 })
      .toBe("Acorn Medic");

    // A page that is not a Denote note keeps its name, which is what it is
    // called anyway.
    await gotoSilverBulletPage(sbPage, sbServer, PLAIN);
    await expect
      .poll(() => sbPage.title(), { timeout: 15_000 })
      .toContain("Notes");
  });

  test("the input underneath still holds the file name", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body.",
      { timeout: 20_000 },
    );
    // 60 assertions across the suite read this, and renaming is still
    // renaming the file: the display is a display.
    await expect(currentPage(sbPage)).toHaveValue(NAME, { timeout: 20_000 });
  });

  test("focusing it gives back the file name to edit", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-current-page .sb-dn-title")).toBeVisible({
      timeout: 20_000,
    });
    await currentPage(sbPage).focus();
    // The formatted version steps aside so what you edit is what you see.
    await expect(
      sbPage.locator("#sb-current-page .sb-denote-name"),
    ).toHaveCount(0);
    await expect(currentPage(sbPage)).toHaveValue(NAME);
  });

  test("on a phone the title gets the room, and keeps it", async ({
    sbPage,
    sbServer,
  }) => {
    await sbPage.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-current-page .sb-dn-title")).toBeVisible({
      timeout: 20_000,
    });

    // The keywords give up their room entirely -- 140px of a 212px bar, for
    // something that is in the note's own front matter anyway.
    await expect(
      sbPage.locator("#sb-current-page .sb-dn-keyword").first(),
    ).toBeHidden();

    // The signature stays, because it is how the library is addressed -- but
    // without its pill, which is what made it expensive here.
    const signature = sbPage.locator("#sb-current-page .sb-dn-signature");
    await expect(signature).toBeVisible();
    expect(
      await signature.evaluate((el) =>
        Math.round(el.getBoundingClientRect().width),
      ),
    ).toBeLessThan(50);

    // And the title is actually readable rather than ellipsised to a stub:
    // it is what the whole bar is for.
    const width = await sbPage.evaluate(() => {
      const el = document.querySelector("#sb-current-page .sb-dn-title")!;
      // The title's own box hugs its text -- it is capped, never shrunk --
      // so the room it has is the row it sits in, and what it needs is the
      // text's own rect.
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        shown: Math.round(
          document
            .querySelector("#sb-current-page .sb-dn-main")!
            .getBoundingClientRect().width,
        ),
        needed: Math.round(range.getBoundingClientRect().width),
        bar: Math.round(
          document.querySelector("#sb-current-page")!.getBoundingClientRect()
            .width,
        ),
      };
    });
    expect(width.shown).toBeGreaterThanOrEqual(width.needed);
    // And it has nearly all of the name's room rather than a corner of it:
    // the signature is the only other claim on it, and as plain mono text
    // that is about a fifth, where the pill and the date together were two
    // thirds. (A toolbar icon is 32px, so what is left over here moves with
    // how many buttons the space's config asks for; the share does not.)
    expect(width.shown / width.bar).toBeGreaterThan(0.7);
  });

  test("a page that is not a Denote note is left as its name", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, PLAIN);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Plain markdown",
      { timeout: 20_000 },
    );
    await expect(
      sbPage.locator("#sb-current-page .sb-denote-name"),
    ).toHaveCount(0);
    // Markdown page names drop the extension in the bar, as they always have.
    await expect(currentPage(sbPage)).toHaveValue("Notes");
  });
});

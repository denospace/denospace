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
        identifier: q(".sb-dn-identifier"),
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
        identifier: "Jul 6, 2026",
        keywords: ["likenow", "mission"],
      });
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

    // The date and the keywords give up their room entirely -- 250px of a
    // 212px bar, for things that are in the note's front matter anyway.
    for (const part of ["identifier", "keyword"]) {
      await expect(
        sbPage.locator(`#sb-current-page .sb-dn-${part}`).first(),
      ).toBeHidden();
    }

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
      };
    });
    expect(width.shown).toBeGreaterThanOrEqual(width.needed);
    // Not merely "fits" -- it fits with room over. Measured at 390px: the
    // bar leaves 212px for the name, the signature takes 35px of it, and
    // this title needs about 105px of the rest.
    expect(width.shown - width.needed).toBeGreaterThan(40);
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

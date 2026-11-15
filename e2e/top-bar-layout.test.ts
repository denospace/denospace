import { expect, gotoSilverBulletPage, type Page, test } from "./fixtures.ts";

/**
 * The top bar has one row for four facts and a toolbar, and they do not all
 * fit. The order they give way in is the whole design: the title is what is
 * read, the signature is how the library is addressed, the date is the
 * note's identity -- and the keywords are the part that can wait.
 */

const fm = (title: string, id: string, sig: string, tags: string) =>
  `#+title:      ${title}
#+filetags:   ${tags}
#+identifier: ${id}
#+signature:  ${sig}

Body.
`;

const LONG =
  "20260706T090036==25=00--how-the-pittsburgh-book-came-together-in-the-end__likenow_mission_writing.org";
const SHORT = "20260706T090040==25=01--acorn__likenow_mission_writing.org";
const JOURNAL = "journal/20261113T090000--friday-13-november-2026__journal.org";
const LATER = "journal/20261114T090000--saturday-14-november-2026__journal.org";

/**
 * What a reader can actually see. A keyword that no longer fits is wrapped
 * onto a second line inside a one-line-tall box, so it is still in the DOM
 * with a width -- and invisible. Anything the box does not contain is out.
 */
function visible(page: Page) {
  return page.evaluate(() => {
    const box = document
      .querySelector("#sb-current-page .sb-dn-keywords")!
      .getBoundingClientRect();
    const inside = (el: Element) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.left >= box.left - 0.5 &&
        r.right <= box.right + 0.5 &&
        r.top >= box.top - 0.5 &&
        r.bottom <= box.bottom + 0.5
      );
    };
    const whole = (selector: string) => {
      const el = document.querySelector(
        `#sb-current-page ${selector}`,
      ) as HTMLElement | null;
      // Shaved by its own `overflow: hidden`, which is what a pill must
      // never be.
      return el ? el.scrollWidth <= el.clientWidth + 1 : null;
    };
    return {
      // Sorted by where they are, not by DOM order: the row is laid out
      // right to left so that the keywords nearest the title are the first
      // to go, and this is the check that they still *read* left to right.
      keywords: [
        ...document.querySelectorAll("#sb-current-page .sb-dn-keyword"),
      ]
        .filter(inside)
        .sort(
          (a, b) =>
            a.getBoundingClientRect().left - b.getBoundingClientRect().left,
        )
        .map((el) => el.textContent),
      signatureWhole: whole(".sb-dn-signature"),
      dateWhole: whole(".sb-dn-identifier"),
      titleWidth: Math.round(
        document
          .querySelector("#sb-current-page .sb-dn-title")!
          .getBoundingClientRect().width,
      ),
      arrows: [
        ...document.querySelectorAll("#sb-current-page .sb-dn-journal"),
      ].map((el) => el.textContent?.trim()),
    };
  });
}

async function open(page: Page, server: any, name: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSilverBulletPage(page, server, name);
  await expect(page.locator("#sb-editor .cm-content")).toContainText("Body.", {
    timeout: 20_000,
  });
}

test.describe("The top bar's row", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      [LONG]: fm(
        "How the Pittsburgh Book Came Together in the End",
        "20260706T090036",
        "25=00",
        ":likenow:mission:writing:",
      ),
      [SHORT]: fm(
        "Acorn",
        "20260706T090040",
        "25=01",
        ":likenow:mission:writing:",
      ),
      [JOURNAL]:
        "#+title:      Friday 13 November 2026\n#+filetags:   :journal:\n#+identifier: 20261113T090000\n\nBody.\n",
      [LATER]:
        "#+title:      Saturday 14 November 2026\n#+filetags:   :journal:\n#+identifier: 20261114T090000\n\nBody.\n",
    },
  });

  test("a long title keeps the room, and takes it from the keywords", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, LONG);
    const long = await expect
      .poll(() => visible(sbPage), { timeout: 15_000 })
      .toMatchObject({ signatureWhole: true, dateWhole: true })
      .then(() => visible(sbPage));
    // The address and the date are short and mean nothing truncated, so they
    // are whole or absent -- never shaved.
    expect(long.keywords).toEqual([]);

    // Same three keywords, same bar, a title that leaves room for them.
    await open(sbPage, sbServer, SHORT);
    const short = await expect
      .poll(() => visible(sbPage), { timeout: 15_000 })
      .toMatchObject({ signatureWhole: true, dateWhole: true })
      .then(() => visible(sbPage));
    expect(short.keywords).toEqual(["likenow", "mission", "writing"]);
    // ... and the long title spent that room on itself.
    expect(long.titleWidth).toBeGreaterThan(short.titleWidth);
  });

  test("a journal entry gets arrows, and other pages do not", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, LONG);
    await expect
      .poll(() => visible(sbPage).then((v) => v.arrows), { timeout: 15_000 })
      .toEqual([]);

    await open(sbPage, sbServer, LATER);
    await expect
      .poll(() => visible(sbPage).then((v) => v.arrows), { timeout: 15_000 })
      .toEqual(["‹", "›"]);
  });

  test("the back arrow turns to the entry before it", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer, LATER);
    await expect
      .poll(() => visible(sbPage).then((v) => v.arrows.length), {
        timeout: 15_000,
      })
      .toBe(2);
    await sbPage.locator("#sb-current-page .sb-dn-journal").first().click();
    await expect
      .poll(() => decodeURIComponent(sbPage.url()), { timeout: 15_000 })
      .toContain("20261113T090000");
  });
});

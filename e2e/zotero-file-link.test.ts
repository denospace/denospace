import {
  expect,
  gotoSilverBulletPage,
  showMetadata,
  test,
} from "./fixtures.ts";
import { runCommandViaPalette } from "./navigator-ui.ts";

/**
 * Getting from a reference note to the file it is about.
 *
 * The note's `#+file:` line is the only thing in it that names the file, and
 * three things stood between it and a click: a keyword's value was plain
 * text, so the link was not a link; a *described* `zotero:` link fell
 * through to `zotero:KEY` as its address, which is not one a browser can
 * follow; and the block it lives in is folded away by default, so there was
 * nothing to click at all.
 */

const NOTE = "20261114T173333--elliott-williams-cv__bib.org";
const KEY = "ZRSX2MUP";
const BODY = `#+title:      Elliott Williams CV
#+filetags:   :bib:
#+identifier: 20261114T173333
#+zotero:     GN7RT6GQ tags:
#+file:       [[zotero:${KEY}][Elliott Williams CV.pdf]]

What it says about itself goes here.
`;

test.describe("A reference note's file", () => {
  test.use({
    spaceFiles: { "index.md": "# Home\n", [NOTE]: BODY },
  });

  const links = (page: any) =>
    page.evaluate(() =>
      [...document.querySelectorAll("#sb-editor a")].map((a) => ({
        text: a.textContent,
        href: (a as HTMLAnchorElement).getAttribute("href"),
        key: (a as HTMLElement).dataset.linkZotero ?? null,
      })),
    );

  test("the `#+file:` link is a link, and addresses the item", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NOTE);
    await showMetadata(sbPage);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "What it says about itself",
      { timeout: 20_000 },
    );

    await expect
      .poll(() => links(sbPage), { timeout: 15_000 })
      .toEqual([
        {
          text: "Elliott Williams CV.pdf",
          // With no `zotero.username` configured there is nowhere on the web to
          // send it, so the desktop app's own URL is what there is. It used to
          // be `zotero:ZRSX2MUP`, which does nothing at all when clicked.
          href: `zotero://select/library/items/${KEY}`,
          key: KEY,
        },
      ]);
  });

  test("the keyword's other values stay plain text", async ({
    sbPage,
    sbServer,
  }) => {
    // Only a link is linkified. The full inline parser over a keyword value
    // would make `#+title: *Hamlet*` bold and `#+filetags:` a mess.
    await gotoSilverBulletPage(sbPage, sbServer, NOTE);
    await showMetadata(sbPage);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "What it says about itself",
      { timeout: 20_000 },
    );
    const lines = await sbPage.evaluate(() =>
      [...document.querySelectorAll("#sb-editor .cm-line")].map(
        (line) => line.textContent ?? "",
      ),
    );
    expect(lines).toContain("#+title:      Elliott Williams CV");
    expect(lines).toContain("#+filetags:   :bib:");
  });

  test("`Zotero: Open` reaches the file with the block folded away", async ({
    sbPage,
    sbServer,
  }) => {
    // The point of it: the `#+file:` line is hidden by default, and nobody
    // wants to go hunting for a link with a caret. The note is the file's
    // note, so the command opens it from anywhere in the note.
    await gotoSilverBulletPage(sbPage, sbServer, NOTE);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "What it says about itself",
      { timeout: 20_000 },
    );
    // Nothing of the block on screen, and no caret anywhere near it.
    await expect(sbPage.locator("#sb-editor a")).toHaveCount(0);

    await runCommandViaPalette(sbPage, "Zotero: Open");
    // There are no credentials here, so it cannot actually open anything --
    // but which complaint it makes says whether it got that far. Asking for
    // a username means it found the note's own file and went to open it;
    // the alternative is it reporting that there was nothing to open, which
    // is what it used to say with the caret anywhere but on the link.
    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "Set zotero.username",
      { timeout: 15_000 },
    );
  });
});

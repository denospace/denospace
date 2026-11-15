import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

// book-mode's rule: markers hang in a right-aligned left margin so the text
// column has one left edge whatever the outline depth. The previous layout
// stepped the text in per level and drew a hairline per level crossed.
const NOTE = `#+title:      Book
#+identifier: 20261115T090000

Preamble before any section.

* Alpha
Body of alpha.
** Beta
Body of beta.
*** Gamma
Body of gamma.
**** Delta
Body of delta.

- a bullet
- another bullet

1. first
2. second
10. tenth
`;

test.describe("Book layout", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "20261115T090000--book.org": NOTE,
    },
  });

  /** The x where each line's first glyph actually starts. */
  const edges = (page: any) =>
    page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const line of document.querySelectorAll("#sb-editor .cm-line")) {
        const text = (line.textContent ?? "").trim();
        if (!text) continue;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const value = (node.textContent ?? "").replace(/^\s+/, "");
          if (!value) continue;
          const idx = (node.textContent ?? "").length - value.length;
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          out[text.slice(0, 22)] = range.getBoundingClientRect().left;
          break;
        }
      }
      return out;
    });

  test("every depth shares one text edge, and no guides are drawn", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body of delta.",
      { timeout: 20_000 },
    );
    const at = await edges(sbPage);
    const base = at["Preamble before any se"];
    expect(base).toBeGreaterThan(0);
    // Prose at every outline depth starts where the preamble does.
    for (const key of [
      "Body of alpha.",
      "Body of beta.",
      "Body of gamma.",
      "Body of delta.",
    ]) {
      expect(Math.abs(at[key] - base)).toBeLessThan(1);
    }
    // And so do the headings themselves -- depth is weight, not position.
    for (const key of ["Alpha", "Beta", "Gamma", "Delta"]) {
      expect(Math.abs(at[key] - base)).toBeLessThan(1);
    }

    // The hairline guides are gone: nothing is painted in a left margin.
    const guide = await sbPage.evaluate(() => {
      const line = document.querySelector("#sb-editor .cm-line")!;
      const before = getComputedStyle(line, "::before");
      return { image: before.backgroundImage, width: before.width };
    });
    expect(guide.image === "none" || guide.width === "0px").toBe(true);
  });

  test("list numbers of different widths leave text at the same edge", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "tenth",
      { timeout: 20_000 },
    );
    const at = await edges(sbPage);
    // An ordered item keeps its number in the line text, so the key carries
    // it; look the lines up by what they end with.
    const edgeOf = (needle: string) => {
      const key = Object.keys(at).find((k) => k.includes(needle));
      expect(
        key,
        `no line containing ${needle}: ${Object.keys(at)}`,
      ).toBeTruthy();
      return at[key!];
    };
    // `1.` and `10.` differ by a character; right-aligning the marker in the
    // gutter is what keeps "first" and "tenth" starting at the same x.
    expect(Math.abs(edgeOf("first") - edgeOf("tenth"))).toBeLessThan(1);
    expect(Math.abs(edgeOf("second") - edgeOf("tenth"))).toBeLessThan(1);
  });

  test("a bullet hangs left of the text, not at it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "a bullet",
      { timeout: 20_000 },
    );
    const geom = await sbPage.evaluate(() => {
      const bullet = document.querySelector("#sb-editor .cm-list-bullet")!;
      const line = bullet.closest(".cm-line")!;
      const b = bullet.getBoundingClientRect();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let textLeft = 0;
      while ((node = walker.nextNode())) {
        if (!(node.textContent ?? "").includes("a bullet")) continue;
        const idx = (node.textContent ?? "").indexOf("a bullet");
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + 1);
        textLeft = r.getBoundingClientRect().left;
        break;
      }
      return { bulletRight: b.right, bulletLeft: b.left, textLeft };
    });
    // In the margin: the bullet ends at or before where the text begins.
    expect(geom.bulletRight).toBeLessThanOrEqual(geom.textLeft + 1);
    expect(geom.bulletLeft).toBeLessThan(geom.textLeft);
  });
});

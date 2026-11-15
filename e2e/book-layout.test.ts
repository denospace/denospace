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
  - nested bullet

1. first
2. second
10. tenth

- [ ] a task
`;

test.describe("Book layout", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "20261115T090000--book.org": NOTE,
    },
  });

  /**
   * The x where each line's *text* starts -- skipping anything in the margin,
   * which is the whole point of the layout: the markers are outside the text
   * column, so a measurement that included them would measure the margin.
   */
  const edges = (page: any) =>
    page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const line of document.querySelectorAll("#sb-editor .cm-line")) {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (
            (node.parentElement as Element | null)?.closest(
              ".sb-header-margin, .sb-list-marker, .sb-list-space, " +
                ".cm-list-bullet, .sb-keyword-hang",
            )
          ) {
            continue;
          }
          const value = (node.textContent ?? "").replace(/^\s+/, "");
          if (!value) continue;
          const idx = (node.textContent ?? "").length - value.length;
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          out[value.trim().slice(0, 22)] = range.getBoundingClientRect().left;
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

  test("heading stars sit muted in the margin, in one column", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body of delta.",
      { timeout: 20_000 },
    );
    const margin = await sbPage.evaluate(() => {
      const out: {
        text: string;
        right: number;
        colour: string;
        weight: string;
      }[] = [];
      for (const el of document.querySelectorAll(
        "#sb-editor .sb-header-margin",
      )) {
        const s = getComputedStyle(el);
        out.push({
          text: (el.textContent ?? "").trim(),
          right: Math.round(el.getBoundingClientRect().right * 10) / 10,
          colour: s.color,
          weight: s.fontWeight,
        });
      }
      const body = document.querySelector("#sb-editor .cm-line")!;
      return { margin: out, bodyColour: getComputedStyle(body).color };
    });
    // One per heading, showing its own depth.
    expect(margin.margin.map((m) => m.text)).toEqual([
      "*",
      "**",
      "***",
      "****",
    ]);
    // Right-aligned into one column: every run ends at the same x, however
    // many stars it has. That is what keeps the text edge still.
    const rights = margin.margin.map((m) => m.right);
    for (const r of rights) {
      expect(Math.abs(r - rights[0])).toBeLessThan(1.5);
    }
    // Muted by colour. Deliberately *not* by weight: the hang is in `ch`,
    // and a lighter weight changes what `ch` measures, so the box and the
    // indent stop agreeing and the heading text slides a pixel or two.
    expect(margin.margin[0].colour).not.toEqual(margin.bodyColour);
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

  test("list text starts where prose does, markers in the margin", async ({
    sbPage,
    sbServer,
  }) => {
    // The point of pulling the markers out: a list is prose with a mark
    // beside it, so its words belong on the same left edge as every other
    // line's. Nesting still indents, because that is structure rather than
    // decoration.
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "a task",
      { timeout: 20_000 },
    );
    const at = await edges(sbPage);
    const base = at["Preamble before any se"];
    for (const key of ["a bullet", "another bullet", "first", "tenth"]) {
      const found = Object.keys(at).find((k) => k.startsWith(key));
      expect(found, `no line starting ${key}: ${Object.keys(at)}`).toBeTruthy();
      expect(Math.abs(at[found!] - base)).toBeLessThan(1);
    }
    // A nested item is indented by its nesting and nothing else.
    const nested = Object.keys(at).find((k) => k.startsWith("nested bullet"))!;
    expect(at[nested]).toBeGreaterThan(base + 4);
    expect(at[nested]).toBeLessThan(base + 20);
  });

  test("front matter hangs its `#+`, and nothing else", async ({
    sbPage,
    sbServer,
  }) => {
    // The `#+` is the sigil that says what kind of line this is, so it goes
    // in the margin with the heading stars and the bullets. The key is part
    // of what the line says, so it starts on the edge with the prose.
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Preamble",
      { timeout: 20_000 },
    );
    // Shown rather than folded away, which is how it is read by default --
    // this is about where the lines sit when they are on screen.
    await sbPage.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Editor: Toggle Metadata")`,
      );
    });
    await expect(sbPage.locator("#sb-editor .sb-metadata-fold")).toHaveCount(
      0,
      { timeout: 15_000 },
    );
    const at = await edges(sbPage);
    const base = at["Preamble before any se"];
    for (const key of ["title", "identifier"]) {
      const found = Object.keys(at).find((k) => k.startsWith(key));
      expect(found, `no key starting ${key}: ${Object.keys(at)}`).toBeTruthy();
      expect(Math.abs(at[found!] - base)).toBeLessThan(1);
    }

    // And the `#+` is out in the margin, right-aligned into the same column
    // the heading stars sit in -- one ragged-right edge of markup, not two.
    const margin = await sbPage.evaluate(() => {
      // The right edge of the glyphs themselves, which is not the right edge
      // of the box: a heading's box holds its trailing space too.
      const glyphRight = (el: Element) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        let right: number | null = null;
        while ((node = walker.nextNode())) {
          const trimmed = (node.textContent ?? "").replace(/\s+$/, "");
          if (!trimmed) continue;
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, trimmed.length);
          right = range.getBoundingClientRect().right;
        }
        return right;
      };
      const all = (selector: string) =>
        [...document.querySelectorAll(`#sb-editor ${selector}`)].map(
          glyphRight,
        );
      return {
        text: document.querySelector("#sb-editor .sb-keyword-hang")!
          .textContent,
        sigils: all(".sb-keyword-hang"),
        stars: all(".sb-header-margin"),
      };
    });
    expect(margin.text).toBe("#+");
    expect(margin.sigils.length).toBeGreaterThan(1);
    expect(margin.stars.length).toBeGreaterThan(1);
    for (const right of [...margin.sigils, ...margin.stars]) {
      expect(right).not.toBeNull();
      // In the margin, and in the same column as each other.
      expect(right!).toBeLessThan(base);
      expect(Math.abs(right! - margin.stars[0]!)).toBeLessThan(1);
    }
  });

  test("a task's checkbox sits at the text edge, not in the margin", async ({
    sbPage,
    sbServer,
  }) => {
    // The `[ ]` is a control you click and a qualifier of the words after it,
    // so it belongs in the text column -- which is also where Bear and iA
    // Writer put one. Only the bullet hangs.
    await gotoSilverBulletPage(sbPage, sbServer, "20261115T090000--book.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "a task",
      { timeout: 20_000 },
    );
    const base = (await edges(sbPage))["Preamble before any se"];
    const box = await sbPage.evaluate(() => {
      const cb = document.querySelector("#sb-editor .sb-checkbox")!;
      return cb.getBoundingClientRect().left;
    });
    expect(Math.abs(box - base)).toBeLessThan(1);
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

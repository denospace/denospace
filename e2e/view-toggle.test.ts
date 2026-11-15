import { expect, gotoSilverBulletPage, type Page, test } from "./fixtures.ts";

/**
 * Two layouts, and the switch between them.
 *
 * Prose view puts every marker in the left margin, so the text column has one
 * left edge however deep a line sits. Outline view steps each level in and
 * draws a hairline per level crossed, so a deep tree is read off the left
 * edge. They are good at different things, which is why both are kept.
 */

const NAME = "20261117T090000==21=06--two-views__one.org";
const NOTE = `#+title:      Two Views
#+filetags:   :one:
#+identifier: 20261117T090000

Preamble before any section.

* Alpha

Body of alpha.

** Beta

- a bullet
`;

test.describe("Prose view and outline view", () => {
  test.use({
    spaceFiles: { "index.md": "# Home\n", [NAME]: NOTE },
  });

  const shape = (page: Page) =>
    page.evaluate(() => {
      const lines = [...document.querySelectorAll("#sb-editor .cm-line")];
      const at = (needle: string) =>
        lines.find((line) => (line.textContent ?? "").includes(needle));
      const left = (needle: string) => {
        const line = at(needle);
        if (!line) return null;
        // Where the *text* starts, which in prose view is not where the line
        // starts: the markers hang outside it.
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
          const index = (node.textContent ?? "").length - value.length;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          return Math.round(range.getBoundingClientRect().left);
        }
        return null;
      };
      const beta = at("Beta");
      return {
        layout: document.documentElement.dataset.layout ?? null,
        preamble: left("Preamble"),
        alpha: left("Alpha"),
        beta: left("Beta"),
        bullet: left("a bullet"),
        // The guide hairlines, drawn in the indent a level opened up.
        guides: beta
          ? parseFloat(getComputedStyle(beta, "::before").width) || 0
          : 0,
        // Prose view keeps the stars and mutes them; outline view takes them
        // out of the document altogether.
        stars: document.querySelectorAll("#sb-editor .sb-header-margin").length,
      };
    });

  const toggle = (page: Page) =>
    page.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Editor: Toggle Outline View")`,
      );
    });

  test("prose view is one text edge, outline view is a staircase", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body of alpha.",
      { timeout: 20_000 },
    );

    const prose = await expect
      .poll(() => shape(sbPage), { timeout: 15_000 })
      .toMatchObject({ layout: "prose" })
      .then(() => shape(sbPage));
    // Prose: a preamble, a heading, a deeper heading and a bullet all start
    // their text in the same column, and nothing is ruled.
    expect(prose.alpha).toBe(prose.preamble);
    expect(prose.beta).toBe(prose.preamble);
    expect(prose.bullet).toBe(prose.preamble);
    expect(prose.guides).toBe(0);
    expect(prose.stars).toBeGreaterThan(0);

    await toggle(sbPage);
    const outline = await expect
      .poll(() => shape(sbPage), { timeout: 15_000 })
      .toMatchObject({ layout: "outline" })
      .then(() => shape(sbPage));
    // Outline: each level is further in than the one above, and the indent
    // a level opened up is ruled for its whole width.
    expect(outline.preamble).toBe(prose.preamble);
    expect(outline.alpha).toBe(outline.preamble);
    expect(outline.beta!).toBeGreaterThan(outline.alpha!);
    expect(outline.guides).toBeGreaterThan(0);
    // And the stars are gone rather than hidden -- CodeMirror places carets
    // by DOM rects, so a marker with no rect is one it can land inside.
    expect(outline.stars).toBe(0);

    await toggle(sbPage);
    await expect
      .poll(() => shape(sbPage), { timeout: 15_000 })
      .toMatchObject({ layout: "prose", guides: 0 });
  });

  test("the view follows the reader to the next note", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body of alpha.",
      { timeout: 20_000 },
    );
    await toggle(sbPage);
    await expect
      .poll(() => shape(sbPage), { timeout: 15_000 })
      .toMatchObject({ layout: "outline" });

    // Per device, like the metadata fold: a layout re-chosen on every note is
    // not a layout.
    await gotoSilverBulletPage(sbPage, sbServer, "index.md");
    await gotoSilverBulletPage(sbPage, sbServer, NAME);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "Body of alpha.",
      { timeout: 20_000 },
    );
    await expect
      .poll(() => shape(sbPage), { timeout: 15_000 })
      .toMatchObject({ layout: "outline" });
  });
});

import { expect, gotoSilverBulletPage, type Page, test } from "./fixtures.ts";

/**
 * Tufte view, measured against the stylesheet the site is actually built
 * with -- `themes/hugo-tufte/assets/scss/tufte.scss` in elliottw.github.io.
 *
 * Its values are rem against a 15px root, so they are checked here in the
 * pixels they come to: 1.4rem of body text is 21px on 30, an h1 is 3.2rem
 * and so 48, and the headings are weight 900 rather than Tufte CSS's own
 * 400. What the site does with its margins -- sidenotes, margin notes,
 * figures with captions in the gutter -- is deliberately not here: none of
 * it is in Org, and a view that drew it would be showing something the file
 * does not say.
 */

const NOTE = "20261115T090000==21=04--on-typography__writing.org";
const BODY = `#+title:      On Typography
#+filetags:   :writing:
#+identifier: 20261115T090000

A paragraph of prose.

* A Section

Body of the section.

** A Subsection

More body.

*** Third Level

- a bullet
`;

test.describe("Tufte view", () => {
  test.use({
    spaceFiles: { "index.md": "# Home\n", [NOTE]: BODY },
  });

  const open = async (page: Page, server: any) => {
    await gotoSilverBulletPage(page, server, NOTE);
    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "A paragraph of prose.",
      { timeout: 20_000 },
    );
    // Round the cycle rather than through the picker: the picker is what
    // the first test drives, and this helper runs before every one of them.
    for (let step = 0; step < 3; step++) {
      const at = await page.evaluate(
        () => document.documentElement.dataset.layout,
      );
      if (at === "tufte") break;
      await page.evaluate(() => {
        void (globalThis as any).sbRuntime.evalLuaScript(
          `editor.invokeCommand("Editor: Cycle View")`,
        );
      });
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.dataset.layout),
          { timeout: 15_000 },
        )
        .not.toBe(at);
    }
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.dataset.layout),
        { timeout: 15_000 },
      )
      .toBe("tufte");
    // The faces are fetched on first use, and the sizes below are the
    // rendered ones.
    await page.evaluate(() => (document as any).fonts.ready);
  };

  test("the picker names the three, and lands on the one chosen", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, NOTE);
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "A paragraph of prose.",
      { timeout: 20_000 },
    );
    await sbPage.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Editor: Switch View")`,
      );
    });
    const filter = sbPage
      .locator(".sb-modal-box input, .sb-modal input")
      .first();
    await expect(filter).toBeVisible({ timeout: 15_000 });
    await filter.fill("Tufte");
    // Wait for the list to have caught up with the typing before choosing.
    await expect(
      sbPage.locator(".sb-modal-box .sb-result-list, .sb-modal li").first(),
    ).toContainText("Tufte", { timeout: 15_000 });
    await filter.press("Enter");
    await expect
      .poll(
        () => sbPage.evaluate(() => document.documentElement.dataset.layout),
        { timeout: 15_000 },
      )
      .toBe("tufte");
  });

  test("the type is the site's, down to the pixel", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer);
    const type = await sbPage.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(`#sb-editor ${selector}`);
        return el ? getComputedStyle(el as HTMLElement) : null;
      };
      const content = style(".cm-content")!;
      const at = (selector: string) => {
        const s = style(selector)!;
        return {
          size: Math.round(parseFloat(s.fontSize) * 100) / 100,
          weight: s.fontWeight,
          style: s.fontStyle,
        };
      };
      return {
        // ET Book itself, bundled, and first in the stack.
        etBook: (document as any).fonts.check("21px et-book"),
        family: content.fontFamily.split(",")[0],
        body: content.fontSize,
        leading: content.lineHeight,
        h1: at(".sb-line-h1"),
        h2: at(".sb-line-h2"),
        h3: at(".sb-line-h3"),
      };
    });

    expect(type.etBook).toBe(true);
    expect(type.family).toBe("et-book");
    // 1.4rem on 2rem against a 15px root.
    expect(type.body).toBe("21px");
    expect(type.leading).toBe("30px");
    // 3.2rem, 2.2rem, 1.7rem -- and `h1, h2, h3 { font-weight: 900 }`, which
    // is the site's own rule and not Tufte CSS's 400.
    expect(type.h1.size).toBeCloseTo(48, 0);
    expect(type.h2.size).toBeCloseTo(33, 0);
    expect(type.h3.size).toBeCloseTo(25.5, 0);
    for (const heading of [type.h1, type.h2, type.h3]) {
      expect(heading.weight).toBe("900");
    }
    // `h2, h3 { font-style: italic }`; h1 is upright.
    expect(type.h1.style).toBe("normal");
    expect(type.h2.style).toBe("italic");
    expect(type.h3.style).toBe("italic");
  });

  test("the measure is the site's, and the paper is ivory", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer);
    const page = await sbPage.evaluate(() => ({
      // 55% of an 87.5% body: about 64 characters at this size.
      measure: Math.round(
        document
          .querySelector("#sb-editor .cm-content")!
          .getBoundingClientRect().width,
      ),
      paper: getComputedStyle(document.documentElement)
        .getPropertyValue("--root-background-color")
        .trim(),
    }));
    expect(page.measure).toBe(672);
    expect(page.paper).toBe("#fffff8");
  });

  test("the markup is out of the way until the caret is on it", async ({
    sbPage,
    sbServer,
  }) => {
    await open(sbPage, sbServer);
    // No stars in the text, and none hanging in a margin either: this view
    // has no margin to hang them in.
    await expect(sbPage.locator("#sb-editor .sb-header-margin")).toHaveCount(0);
    const before = await sbPage.evaluate(() =>
      [...document.querySelectorAll("#sb-editor .cm-line")]
        .map((line) => line.textContent ?? "")
        .filter((text) => text.includes("A Section")),
    );
    expect(before).toEqual(["A Section"]);

    // The caret arriving brings them back, which is how the line is edited.
    await sbPage
      .locator("#sb-editor .cm-line", { hasText: "A Section" })
      .first()
      .click();
    await expect
      .poll(
        () =>
          sbPage.evaluate(() =>
            [...document.querySelectorAll("#sb-editor .cm-line")]
              .map((line) => line.textContent ?? "")
              .filter((text) => text.includes("A Section")),
          ),
        { timeout: 15_000 },
      )
      .toEqual(["* A Section"]);
  });
});

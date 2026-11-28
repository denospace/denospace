import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

// `Editor: Toggle Markup Display`, which was called
// `Editor: Toggle Markdown Syntax Rendering` until it was noticed that it had
// never been about Markdown: it governs the whole clean-mode plugin set, Org's
// own plugins included. These assert that on an Org note -- the only kind a
// space holds -- it genuinely hides and reveals Org's own markers.
const NOTE = `#+title:      Markup
#+identifier: 20261128T120000

Some *bold* and /italic/ prose.
`;

test.describe("Toggle Markup Display", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "20261128T120000--markup.org": NOTE,
    },
  });

  /**
   * What the editor actually shows. A hidden mark is
   * `Decoration.replace({})` -- out of the DOM, not merely transparent -- so
   * reading the text is the whole test.
   */
  const shown = (page: any) =>
    page.evaluate(
      () => document.querySelector("#sb-editor .cm-content")!.textContent ?? "",
    );

  const attr = (page: any) =>
    page.evaluate(() => document.documentElement.dataset.rawMarkup);

  const toggle = (page: any) =>
    page.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Editor: Toggle Markup Display")`,
      );
    });

  test("hides and reveals Org's emphasis markers", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261128T120000--markup.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "bold",
      { timeout: 20_000 },
    );

    // Live preview is the default, so the markers are gone and the words are
    // not: `*bold*` reads as `bold`.
    expect(await attr(sbPage)).toBe("off");
    const preview = await shown(sbPage);
    expect(preview).toContain("Some bold and italic prose.");
    expect(preview).not.toContain("*bold*");
    expect(preview).not.toContain("/italic/");

    await toggle(sbPage);
    await expect.poll(() => attr(sbPage), { timeout: 15_000 }).toBe("on");
    const raw = await shown(sbPage);
    expect(raw).toContain("*bold*");
    expect(raw).toContain("/italic/");

    // And back.
    await toggle(sbPage);
    await expect.poll(() => attr(sbPage), { timeout: 15_000 }).toBe("off");
    await expect
      .poll(() => shown(sbPage), { timeout: 15_000 })
      .not.toContain("*bold*");
  });

  test("the choice survives a reload", async ({ sbPage, sbServer }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "20261128T120000--markup.org");
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "bold",
      { timeout: 20_000 },
    );
    await toggle(sbPage);
    await expect.poll(() => attr(sbPage), { timeout: 15_000 }).toBe("on");

    await sbPage.reload();
    await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
      "bold",
      { timeout: 20_000 },
    );
    // Stored per client, like dark mode and the prose face: a display
    // preference belongs to the device, not the space. This is also what
    // reads the renamed `clientStore` key back.
    await expect.poll(() => attr(sbPage), { timeout: 20_000 }).toBe("on");
    await expect
      .poll(() => shown(sbPage), { timeout: 20_000 })
      .toContain("*bold*");
  });
});

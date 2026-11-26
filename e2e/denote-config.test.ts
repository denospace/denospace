import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

function runCommand(page: any, name: string) {
  return page.evaluate((command: string) => {
    void (globalThis as any).sbRuntime.evalLuaScript(
      `editor.invokeCommand("${command}")`,
    );
  }, name);
}

// Every `denote.*` key is declared in `Library/Std/Config.md`, which is what
// puts them in front of a user at all: undeclared, they work but appear
// nowhere in Configuration, and a typo in a CONFIG page is read as a default
// instead of reported.
test.describe("Denote settings in Configuration", () => {
  test.use({ spaceFiles: { "index.md": "# Home\n" } });

  test("the Denote and Journal categories list their keys", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(2000);
    await runCommand(sbPage, "Configuration: Open");

    // The panel renders in its own iframe.
    const panel = sbPage.frameLocator("iframe").first();
    await expect(panel.locator(".cfg-category-title").first()).toBeVisible({
      timeout: 20_000,
    });
    const categories = await panel
      .locator(".cfg-category-title")
      .allTextContents();
    expect(categories).toContain("Denote");
    expect(categories).toContain("Journal");

    const labels = await panel.locator(".cfg-field-label").allTextContents();
    // The pipeline setting, the format, and the journal's three.
    expect(labels).toContain("Creation prompts");
    expect(labels).toContain("File type");
    expect(labels).toContain("Rename on save");
    expect(labels).toContain("Journal directory");
    expect(labels).toContain("Journal keyword");
    expect(labels).toContain("Journal title format");
  });
});

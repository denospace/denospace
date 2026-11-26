import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";
import { currentPage } from "./navigator-ui.ts";

// `consult-denote-grep`: type, see matching lines from the whole library,
// land on the line. The point is the *line* -- a page picker already finds
// pages.
const org = (id: string, title: string, body: string) =>
  `#+title:      ${title}\n#+identifier: ${id}\n\n${body}\n`;

test.describe("Search Notes", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "20261102T100000--outreach.org": org(
        "20261102T100000",
        "Outreach",
        "* Calls\nleft a voicemail for brandi gurcak\nnothing else here\n",
      ),
      "20261102T100001--shed.org": org(
        "20261102T100001",
        "Shed",
        "* Materials\nordered the cedar shingles\n- [ ] call brandi about the permit\n",
      ),
      "20261102T100002--quiet.org": org(
        "20261102T100002",
        "Quiet",
        "nothing to find in this one\n",
      ),
    },
  });

  const open = (page: any) =>
    page.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Navigate: Search Notes")`,
      );
    });

  // A navigator view, not a filter box: its own input and row markup.
  const filter = (page: any) => page.locator(".sb-nav-input").first();

  const rows = (page: any) => page.locator(".sb-nav-primary").allTextContents();

  test("finds matching lines across notes and opens the line", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    // Let the space index settle -- the search reads indexed objects.
    await sbPage.waitForTimeout(3000);
    await open(sbPage);
    await expect(filter(sbPage)).toBeVisible({ timeout: 20_000 });

    // Under the minimum, nothing is offered rather than everything.
    await filter(sbPage).fill("br");
    await sbPage.waitForTimeout(600);
    expect((await rows(sbPage)).join("|")).not.toContain("brandi");

    await filter(sbPage).fill("brandi");
    await expect
      .poll(() => rows(sbPage), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("voicemail for brandi gurcak"),
        ]),
      );
    // Both notes that mention her, including the one in a task.
    const found = (await rows(sbPage)).join("|");
    expect(found).toContain("brandi about the permit");
    // And not the note that says nothing.
    expect(found).not.toContain("nothing to find");

    await filter(sbPage).press("Enter");
    // Lands on the page holding the line.
    await expect(currentPage(sbPage)).toHaveValue(
      /20261102T10000[01]--(outreach|shed)\.org/,
      { timeout: 20_000 },
    );
  });

  test("matching is case-insensitive and takes punctuation literally", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(3000);
    await open(sbPage);
    await expect(filter(sbPage)).toBeVisible({ timeout: 20_000 });

    await filter(sbPage).fill("BRANDI");
    await expect
      .poll(() => rows(sbPage), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([expect.stringContaining("brandi gurcak")]),
      );

    // A regex metacharacter is a character, not a pattern: `%s` finds nothing
    // here rather than matching every space.
    await filter(sbPage).fill("%s+");
    await sbPage.waitForTimeout(800);
    expect((await rows(sbPage)).join("|")).not.toContain("voicemail");
  });
});

// `denote-grep`'s query buffer does two things this picker did not: it labels
// each hit with the note it came from, and it narrows the result set. These
// cover both, plus the dock that makes it a buffer rather than a picker.
test.describe("Search Notes: the query buffer", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n",
      "20261103T100000--levee-repair__permits.org":
        `#+title:      Levee Repair\n#+filetags:   :permits:\n` +
        `#+identifier: 20261103T100000\n\nthe culvert needs replacing\n`,
      "20261103T100001--shed-plans__drafts.org":
        `#+title:      Shed Plans\n#+filetags:   :drafts:\n` +
        `#+identifier: 20261103T100001\n\nthe culvert drains downhill\n`,
      "20261103T100002--notes__permits.org":
        `#+title:      Site Notes\n#+filetags:   :permits:\n` +
        `#+identifier: 20261103T100002\n\nculvert inspection booked\n`,
    },
  });

  const open = (page: any) =>
    page.evaluate(() => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("Navigate: Search Notes")`,
      );
    });
  const run = (page: any, command: string) =>
    page.evaluate((c: string) => {
      void (globalThis as any).sbRuntime.evalLuaScript(
        `editor.invokeCommand("${c}")`,
      );
    }, command);
  const filter = (page: any) => page.locator(".sb-nav-input").first();
  const rows = (page: any) => page.locator(".sb-nav-primary").allTextContents();
  const descriptions = (page: any) =>
    page.locator(".sb-nav-description").allTextContents();

  test("labels each hit with the note's title, not its file name", async ({
    sbPage,
    sbServer,
  }) => {
    // A Denote file name is a slug of the title with the identifier and
    // keywords stuck to it, so the raw name tells a reader less than the
    // title does -- the same reason the backlinks panel shows titles.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(3000);
    await open(sbPage);
    await expect(filter(sbPage)).toBeVisible({ timeout: 20_000 });
    await filter(sbPage).fill("culvert");
    await expect
      .poll(() => rows(sbPage), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([expect.stringContaining("needs replacing")]),
      );
    const shown = (await descriptions(sbPage)).join("|");
    expect(shown).toContain("Levee Repair");
    expect(shown).toContain("Shed Plans");
    expect(shown).not.toContain("20261103T100000");
  });

  test("a keyword filter narrows the search, and clearing restores it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(3000);
    await open(sbPage);
    await expect(filter(sbPage)).toBeVisible({ timeout: 20_000 });
    await filter(sbPage).fill("culvert");
    // All three notes mention it.
    await expect.poll(() => rows(sbPage), { timeout: 20_000 }).toHaveLength(3);

    // `Search: Only Keyword` picks from the library's keywords, so the
    // keyword prompt opens on top of the panel.
    await run(sbPage, "Search: Only Keyword");
    // `editor.filterBox` renders `.sb-filter-input`; the panel's own input is
    // `.sb-nav-input`, so the generic modal selector picks the wrong one.
    const keywordBox = sbPage.locator(".sb-filter-input").first();
    await expect(keywordBox).toBeVisible({ timeout: 20_000 });
    await keywordBox.fill("permits");
    // Enter takes whichever row is selected, and typing does not narrow the
    // list synchronously -- pressing it straight after `fill` picked `drafts`
    // (row 0 of the unnarrowed list) on two runs in three. Wait for the list
    // to actually be the one row before taking it.
    // The total, not the matching count: `permits` is already one of the two
    // rows before narrowing, so a count of matching rows is satisfied by the
    // list this is waiting to leave.
    await expect(sbPage.locator(".sb-result-list .sb-name")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(sbPage.locator(".sb-result-list .sb-name").first()).toHaveText(
      "permits",
    );
    await keywordBox.press("Enter");

    // Only the two `permits` notes survive, and the panel says what it is
    // hiding behind.
    await expect
      .poll(() => rows(sbPage), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("Filtered: keyword permits"),
        ]),
      );
    const narrowed = (await descriptions(sbPage)).join("|");
    expect(narrowed).toContain("Levee Repair");
    expect(narrowed).toContain("Site Notes");
    expect(narrowed).not.toContain("Shed Plans");

    await run(sbPage, "Search: Clear Filters");
    await expect
      .poll(async () => (await descriptions(sbPage)).join("|"), {
        timeout: 20_000,
      })
      .toContain("Shed Plans");
  });

  test("docked, it stays open while you walk the matches", async ({
    sbPage,
    sbServer,
  }) => {
    // The difference between `consult-denote-grep` and `denote-grep`: a modal
    // closes on the match you take, a buffer does not. Walking several hits
    // from one search is the whole reason to have the buffer, and it is why
    // this view declares `supportedDocks` at all.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    await sbPage.waitForTimeout(3000);
    await open(sbPage);
    await expect(filter(sbPage)).toBeVisible({ timeout: 20_000 });

    // Move it out of the modal slot through the panel's own placement menu.
    await sbPage.getByRole("button", { name: /Change placement/ }).click();
    await sbPage.getByRole("menuitem", { name: "Left sidebar" }).click();
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0, {
      timeout: 20_000,
    });

    await filter(sbPage).fill("culvert");
    await expect.poll(() => rows(sbPage), { timeout: 20_000 }).toHaveLength(3);

    // Take a match: the editor goes there and the panel is still showing the
    // other two.
    await sbPage.locator(".sb-nav-row").first().click();
    await expect(currentPage(sbPage)).toHaveValue(/20261103T10000\d/, {
      timeout: 20_000,
    });
    await expect(filter(sbPage)).toBeVisible();
    expect(await rows(sbPage)).toHaveLength(3);

    // And a second one, without searching again.
    await sbPage.locator(".sb-nav-row").nth(1).click();
    await expect(filter(sbPage)).toBeVisible();
    expect(await rows(sbPage)).toHaveLength(3);
  });
});

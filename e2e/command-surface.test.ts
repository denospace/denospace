import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import { navInput, navRows, openPicker } from "./navigator-ui.ts";

// The palette is how nearly everything in the product is reached, so two
// commands doing one thing is a question the user answers every time they
// open it. These assert what is actually offered, in a running client --
// the manifests alone cannot say, because the library defines commands in
// Lua at boot and that is where half of each pair came from.

test.describe("the command palette", () => {
  test.use({ spaceFiles: { "index.md": "# Home\n" } });

  /** Every command the palette offers for `phrase`. */
  async function offered(page: any, phrase: string): Promise<string[]> {
    const frame = await openPicker(page, `${mod}+/`, "Command");
    await navInput(page).fill(phrase);
    await expect(navRows(frame).first()).toBeVisible({ timeout: 20_000 });
    return (await navRows(frame).allTextContents()).map((t) => t.trim());
  }

  test("offers one journal command per action", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    const rows = await offered(sbPage, "Journal");

    // The library's `Journal:` commands are the ones with the key bindings
    // and the `journal.enabled` switch, so they are the ones that survive.
    for (const name of [
      "Journal: Today",
      "Journal: Previous Day",
      "Journal: Next Day",
      "Journal: Picker",
      "Journal: Calendar",
      "Journal: Open Date",
    ]) {
      expect(rows, `${name} should be offered`).toContain(name);
    }

    // And the plug's duplicates are gone. `Journal: Next Day` and `Denote:
    // Journal Next` ran the same journal; only one of them had a key.
    expect(rows.filter((r) => r.startsWith("Denote: Journal"))).toEqual([]);
  });

  test("the note commands are under Note:, not Denote:", async ({
    sbPage,
    sbServer,
  }) => {
    // In a library where every note is a Denote note, the prefix named the
    // Emacs package a command came from rather than anything a reader needs.
    // Asserted in a running client rather than from the manifests, because
    // the manifests are only three of the four places a command is
    // registered -- `Note: Toggle Link Display` comes from client TypeScript
    // and `Note: Link Mentions` from library Lua.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    const rows = await offered(sbPage, "Note: New");

    for (const name of [
      "Note: New",
      "Note: New with Signature",
      "Note: New of Type",
      "Note: New with Date",
      "Note: New in Subdirectory",
      "Note: New from Template",
      "Note: New from Region",
      "Note: New Child",
      "Note: New Sibling",
    ]) {
      expect(rows, `${name} should be offered`).toContain(name);
    }
    expect(rows.filter((r) => r.startsWith("Denote:"))).toEqual([]);
  });

  test("the path-thinking page commands are not offered", async ({
    sbPage,
    sbServer,
  }) => {
    // They contradict a library addressed by identifier, and `Page: Copy`
    // could mint two notes sharing one -- silent corruption. Checked in the
    // client because a command can also come from library Lua, so a manifest
    // with no `command:` block is not proof on its own.
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    const renames = await offered(sbPage, "Rename");
    for (const name of [
      "Page: Rename",
      "Page: Batch Rename Prefix",
      "Page: Rename Linked Page",
      "Document: Rename Document",
    ]) {
      expect(renames, `${name} is back in the palette`).not.toContain(name);
    }
    // What replaced them is there.
    expect(renames).toContain("Note: Rename");
    expect(renames).toContain("Note: Rename from Front Matter");

    const copies = await offered(sbPage, "Copy");
    expect(copies, "Page: Copy is back in the palette").not.toContain(
      "Page: Copy",
    );
  });

  test("offers one way into the libraries panel", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "index");
    const rows = await offered(sbPage, "Library");

    expect(rows).toContain("Library: Manager");
    // `Libraries: Manager` opened the very same panel at the very same tab,
    // and the other four library commands were already `Library:`.
    expect(rows.filter((r) => r.startsWith("Libraries:"))).toEqual([]);
  });
});

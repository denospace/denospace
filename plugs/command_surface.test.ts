import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "js-yaml";
import { expect, test } from "vitest";

// The command palette is the product's surface: it is how nearly everything
// is reached, and two commands doing one thing is a question the user has to
// answer every time they open it. These lock what ships.

const plugsDir = new URL("./", import.meta.url).pathname;

type Command = {
  name: string;
  plug: string;
  requireMode?: string;
  requireEditor?: string;
};

function commands(): Command[] {
  const found: Command[] = [];
  for (const entry of readdirSync(plugsDir)) {
    const dir = join(plugsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) =>
      f.endsWith(".plug.yaml"),
    )) {
      const manifest = YAML.load(readFileSync(join(dir, file), "utf8")) as any;
      for (const fn of Object.values(manifest?.functions ?? {}) as any[]) {
        if (fn?.command?.name) {
          found.push({
            name: fn.command.name,
            plug: entry,
            requireMode: fn.command.requireMode,
            requireEditor: fn.command.requireEditor,
          });
        }
      }
    }
  }
  return found;
}

const all = commands();

test("the manifests were actually read", () => {
  // An empty list would make every case below pass.
  expect(all.length).toBeGreaterThan(100);
});

test("no two commands share a name", () => {
  const seen = new Map<string, string[]>();
  for (const { name, plug } of all) {
    seen.set(name, [...(seen.get(name) ?? []), plug]);
  }
  const clashes = [...seen].filter(([, plugs]) => plugs.length > 1);
  expect(clashes).toEqual([]);
});

test("every command is namespaced", () => {
  // `Namespace: Title`. A bare name sorts nowhere in the palette and reads as
  // an accident.
  expect(
    all.map((c) => c.name).filter((n) => !/^[A-Z][\w ]*: \S/.test(n)),
  ).toEqual([]);
});

test("the namespaces are the ones this product means to have", () => {
  // Written out so adding one is a deliberate act, and so a second namespace
  // for something that already has one cannot creep back. `Libraries` was
  // exactly that: `Libraries: Manager` and `Library: Manager` opened the same
  // panel at the same tab, and the other four library commands were already
  // `Library:`. Singular is also the house style -- `Page:`, `Document:`,
  // `Space:`, `Task:`.
  //
  // `Denote` is deliberately not here. Every note in this fork is a Denote
  // note, so the prefix named the Emacs package a command came from rather
  // than anything a reader needs; `Note:` says what the command acts on.
  expect([...new Set(all.map((c) => c.name.split(": ")[0]))].sort()).toEqual([
    "Blog",
    "Client",
    "Comment",
    "Configuration",
    "Debug",
    "Document",
    "Editor",
    "Flash",
    "Graph",
    "Image Viewer",
    "Journal",
    "Library",
    "Navigate",
    "Note",
    "Outline",
    "Page",
    "Plugs",
    "Space",
    "Stats",
    "Sync",
    "System",
    "Task",
    "Text",
    "Upload",
    "Zotero",
  ]);
});

test("the journal has one command per action", () => {
  // The duplication this cleanup was for: `Journal: Next Day` in the library
  // and `Denote: Journal Next` in this manifest ran the same journal, and
  // only the library's had the key binding and the `journal.enabled` switch.
  // The plug keeps the functions; the library owns the commands.
  expect(
    all
      .map((c) => c.name)
      .filter((n) => /journal/i.test(n))
      .sort(),
  ).toEqual(["Journal: Calendar", "Journal: Open Date"]);
});

test("keywords are one command, not an add and a remove", () => {
  // Denote has no single-file add/remove pair: `-add-keywords` and
  // `-remove-keywords` operate on files marked in Dired. For the file in
  // front of you there is `denote-rename-file-keywords`, prefilled with the
  // note's own keywords, and what you leave behind is what it gets. Two
  // commands meant picking one before knowing whether the edit was an
  // addition or a removal, and neither could do both at once.
  // `Note: Keywords Page` is excluded on purpose: it opens the generated
  // index of the library's keywords and edits nothing.
  expect(
    all
      .map((c) => c.name)
      .filter((n) => /keyword/i.test(n) && n !== "Note: Keywords Page")
      .sort(),
  ).toEqual(["Note: Set Keywords"]);
});

test("a command that writes says so", () => {
  // Offered in a read-only space, each of these fails at the point it tries
  // to write -- after the prompts, which is the worst place to find out.
  // `requireEditor: page` matters too: all of them read the note in front of
  // you to decide what to do. Listed rather than inferred, because what a
  // command writes is not visible from its manifest entry; the list is the
  // claim, and the assertion holds it to it.
  const writes = [
    "Note: New Child",
    "Note: New Sibling",
    "Note: Rename",
    "Note: Rename from Front Matter",
    "Note: Set Keywords",
    "Note: Set Signature",
  ];
  for (const name of writes) {
    const command = all.find((c) => c.name === name);
    expect(command, `${name} is missing from the manifests`).toBeDefined();
    expect(
      command!.requireMode,
      `${name} writes but is offered read-only`,
    ).toBe("rw");
    expect(command!.requireEditor, `${name} needs the note it acts on`).toBe(
      "page",
    );
  }
  // Writes a journal entry for a date that has none, but prompts for the
  // date rather than reading the open page.
  const openDate = all.find((c) => c.name === "Journal: Open Date");
  expect(openDate?.requireMode).toBe("rw");

  // The creation commands write too, but they make a note rather than
  // changing one, so a page in front of them is not required -- only
  // `Note: New from Region`, which reads the selection.
  for (const name of [
    "Note: New",
    "Note: New with Signature",
    "Note: New of Type",
    "Note: New with Date",
    "Note: New in Subdirectory",
    "Note: New from Template",
    "Note: New from Region",
  ]) {
    const command = all.find((c) => c.name === name);
    expect(command, `${name} is missing from the manifests`).toBeDefined();
    expect(
      command!.requireMode,
      `${name} writes but is offered read-only`,
    ).toBe("rw");
  }
  const region = all.find((c) => c.name === "Note: New from Region");
  expect(region?.requireEditor, "the region command reads a selection").toBe(
    "page",
  );
});

test("the path-thinking page commands are not offered", () => {
  // A Denote library is addressed by identifier and its file names are built,
  // not typed. These five contradicted that from inside the palette, and
  // `Page: Copy` was worse than confusing: it wrote the page back verbatim
  // with the current name prefilled, so it could mint two notes sharing one
  // identifier -- which is the one thing Denote's manual says breaks linking,
  // and it breaks it silently.
  //
  // The functions all remain; the top bar still renames a page and a document
  // through `invokeFunction`, by function name rather than command name.
  for (const name of [
    "Page: Rename",
    "Page: Batch Rename Prefix",
    "Page: Rename Linked Page",
    "Page: Copy",
    "Document: Rename Document",
  ]) {
    expect(
      all.find((c) => c.name === name),
      `${name} is back in the palette`,
    ).toBeUndefined();
  }
  // And the Denote commands that replace them are there.
  for (const name of ["Note: Rename", "Note: Rename from Front Matter"]) {
    expect(
      all.find((c) => c.name === name),
      `${name} is missing`,
    ).toBeDefined();
  }
});

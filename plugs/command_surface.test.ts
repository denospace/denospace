import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import YAML from "js-yaml";

// The command palette is the product's surface: it is how nearly everything
// is reached, and two commands doing one thing is a question the user has to
// answer every time they open it. These lock what ships.

const plugsDir = new URL("./", import.meta.url).pathname;

type Command = { name: string; plug: string };

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
          found.push({ name: fn.command.name, plug: entry });
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
  expect([...new Set(all.map((c) => c.name.split(": ")[0]))].sort()).toEqual([
    "Blog",
    "Client",
    "Comment",
    "Configuration",
    "Debug",
    "Denote",
    "Document",
    "Editor",
    "Flash",
    "Graph",
    "Image Viewer",
    "Journal",
    "Library",
    "Navigate",
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

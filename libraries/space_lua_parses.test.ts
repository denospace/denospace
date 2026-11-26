import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../client/boot_config.ts";
import { parseBlock } from "../client/space_lua/parse.ts";

// Every command, widget and template in the standard library is defined in a
// `space-lua` block, and nothing else in the suite parses them. A syntax
// error in one does not fail a build or a test -- the block simply never
// runs, and whatever it defined is missing from the app with nothing said
// about it. This parses what ships.

const root = new URL("./Library/", import.meta.url).pathname;

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return pagesUnder(path);
    }
    return /\.(md|org)$/.test(entry) ? [path] : [];
  });
}

const pages = pagesUnder(root);

test("the library has pages to check", () => {
  // Guards the walk itself: an empty list would make every case below pass.
  expect(pages.length).toBeGreaterThan(40);
});

test.each(
  pages.map((path) => [path.slice(root.length), path]),
)("%s parses as Lua", (_name, path) => {
  const code = extractSpaceLuaFromPageText(readFileSync(path, "utf8"), path);
  if (!code.trim()) {
    return;
  }
  expect(() => parseBlock(code)).not.toThrow();
});

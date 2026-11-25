import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { collectNodesOfType } from "@silverbulletmd/silverbullet/lib/tree";
import { parseOrg } from "../client/org_parser/parser.ts";

// A slash template's body is inserted verbatim into whatever page the cursor
// is in, so its markup has to be the markup of the space. Two of these three
// were broken in an Org page, each invisibly: a ``` fence is a paragraph, and
// `---` is short of Org's five-dash rule. Nothing errored -- the text simply
// sat there as prose.
//
// The table was *not* broken. Org's separator pattern accepts `|---|---|` as
// readily as `|---+---|`, so the Markdown form already parsed; it now uses
// `+` because that is what Org itself writes, and its description no longer
// promises "a markdown table". Said plainly here so nobody reads the test
// below as evidence of a bug that was not there.
//
// Parsing the real file rather than a copy of it is the point: the assertion
// is about what ships.

const dir = new URL("./Library/Std/Slash Templates/", import.meta.url);

/** A template's body: the text after its front matter, with the cursor marker
 * removed the way `insertAtCursor` removes it. */
function body(name: string): string {
  const text = readFileSync(new URL(`${name}.md`, dir), "utf8");
  const end = text.indexOf("\n---\n", 3);
  expect(end, `${name} has no front matter`).toBeGreaterThan(-1);
  return text.slice(end + 5).replaceAll("|^|", "");
}

test("/code inserts an Org source block", () => {
  const tree = parseOrg(body("code"));
  expect(collectNodesOfType(tree, "FencedCode").length).toEqual(1);
});

test("/table inserts an Org table with a header", () => {
  const tree = parseOrg(body("table"));
  expect(collectNodesOfType(tree, "Table").length).toEqual(1);
  // The delimiter row is what makes the first row a header rather than data.
  expect(collectNodesOfType(tree, "TableDelimiter").length).toBeGreaterThan(0);
});

test("/hr inserts an Org horizontal rule", () => {
  // Org wants five dashes or more; Markdown's three parse as nothing here.
  const tree = parseOrg(body("hr"));
  expect(collectNodesOfType(tree, "HorizontalRule").length).toEqual(1);
});

test("no slash template still promises Markdown in its description", () => {
  expect(readFileSync(new URL("table.md", dir), "utf8")).not.toContain(
    "markdown table",
  );
});

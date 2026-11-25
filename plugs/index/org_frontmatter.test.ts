import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { parseOrg } from "../../client/org_parser/parser.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import { collectOrgFrontMatter, parseOrgTagList } from "./org_frontmatter.ts";

const fm = (text: string) => extractFrontMatter(parseOrg(text));

test("a page's keywords become front matter", () => {
  const page = fm(`#+TITLE: Code
#+DESCRIPTION: Insert a fenced code block

Body.
`);
  expect(page.title).toEqual("Code");
  expect(page.description).toEqual("Insert a fenced code block");
});

test("keyword names are matched regardless of case", () => {
  expect(fm("#+title: A\n").title).toEqual("A");
  expect(fm("#+TITLE: A\n").title).toEqual("A");
  expect(fm("#+Title: A\n").title).toEqual("A");
});

test("filetags become page tags", () => {
  // The whole template system finds its templates by tag, so this is the one
  // that decides whether a converted library page works at all.
  expect(fm("#+FILETAGS: :meta:template:slash:\n").tags).toEqual([
    "meta",
    "template",
    "slash",
  ]);
});

test("tags are accepted however they are written", () => {
  expect(parseOrgTagList(":a:b:")).toEqual(["a", "b"]);
  expect(parseOrgTagList("a b")).toEqual(["a", "b"]);
  expect(parseOrgTagList("a, b")).toEqual(["a", "b"]);
  expect(parseOrgTagList("#a #b")).toEqual(["a", "b"]);
  expect(parseOrgTagList("")).toEqual([]);
  expect(parseOrgTagList(":::")).toEqual([]);
});

test("a nested tag keeps its slashes", () => {
  expect(fm("#+FILETAGS: :meta/template/slash:\n").tags).toEqual([
    "meta/template/slash",
  ]);
});

test("a repeated keyword accumulates into a list", () => {
  // Org has no list syntax for keywords, and `exceptContexts` needs two
  // values. Repeating the line is how an Org file says that.
  const page = fm(`#+exceptContexts: FencedCode
#+exceptContexts: LuaDirective
`);
  expect(page.exceptContexts).toEqual(["FencedCode", "LuaDirective"]);
});

test("a single keyword stays a scalar", () => {
  expect(fm("#+exceptContexts: FencedCode\n").exceptContexts).toEqual(
    "FencedCode",
  );
});

test("a boolean arrives as a boolean, not as text", () => {
  // `raw: true` gates how a template's body is inserted; the string "true"
  // would be truthy by accident rather than by meaning.
  expect(fm("#+raw: true\n").raw).toBe(true);
  expect(fm("#+priority: 3\n").priority).toBe(3);
});

test("prose containing a colon survives verbatim", () => {
  // Read as YAML this is a map, which would replace the sentence with an
  // object. A description is prose and has to come back as written.
  const page = fm("#+DESCRIPTION: Insert a table: with a header\n");
  expect(page.description).toEqual("Insert a table: with a header");
});

test("a flow list is read as a list", () => {
  expect(fm('#+onlyContexts: ["FencedCode:space-lua", "LuaDirective"]\n')
    .onlyContexts).toEqual(["FencedCode:space-lua", "LuaDirective"]);
});

test("an empty keyword value is empty, not missing", () => {
  const page = fm("#+DESCRIPTION:\n");
  expect(page.description).toEqual("");
});

test("a keyword inside a source block is not front matter", () => {
  // Otherwise a `#+title:` written as example text would retitle the page.
  const page = fm(`#+TITLE: Real

#+BEGIN_SRC space-lua
-- #+TITLE: Fake
#+END_SRC
`);
  expect(page.title).toEqual("Real");
});

test("collectOrgFrontMatter keeps tags out of the attributes", () => {
  const collected = collectOrgFrontMatter(
    parseOrg("#+TITLE: A\n#+FILETAGS: :x:\n"),
  );
  expect(collected.attributes).toEqual({ title: "A" });
  expect(collected.tags).toEqual(["x"]);
});

test("a Markdown page's YAML front matter still behaves as it did", () => {
  const page = extractFrontMatter(
    parseMarkdown(`---
description: Insert a fenced code block
tags: meta/template/slash
exceptContexts:
- "FencedCode"
- "LuaDirective"
---
Body.
`),
  );
  expect(page.description).toEqual("Insert a fenced code block");
  expect(page.tags).toEqual(["meta/template/slash"]);
  expect(page.exceptContexts).toEqual(["FencedCode", "LuaDirective"]);
});

test("a `#+key:` line in a Markdown page is just text", () => {
  // Markdown has no Org keywords; treating one as front matter there would
  // retitle a page that happens to quote an Org file.
  const page = extractFrontMatter(parseMarkdown("#+TITLE: Not a title\n"));
  expect(page.title).toBeUndefined();
});

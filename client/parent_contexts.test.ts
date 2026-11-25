import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "./markdown_parser/parser.ts";
import { orgLanguage } from "./org_parser/parser.ts";
import { extractParentContexts } from "./parent_contexts.ts";

/**
 * The contexts in force at `marker`'s position. Both syntaxes are parsed the
 * way the editor parses them, so a gate that works in one and not the other
 * shows up here rather than only in a running client.
 */
function contextsAt(
  doc: string,
  marker: string,
  syntax: "markdown" | "org",
): string[] {
  const state = EditorState.create({
    doc,
    extensions: [
      syntax === "org" ? orgLanguage : buildExtendedMarkdownLanguage(),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  const at = doc.indexOf(marker);
  expect(at, `${marker} is not in the document`).toBeGreaterThan(-1);
  return extractParentContexts(state, syntaxTree(state).resolveInner(at, -1));
}

const markdownBlock = "```space-lua\nx = 1\n```\n";
const orgBlock = "#+BEGIN_SRC space-lua\nx = 1\n#+END_SRC\n";

test("a Markdown space-lua block reports its language as a context", () => {
  expect(contextsAt(markdownBlock, "x = 1", "markdown")).toContain(
    "FencedCode:space-lua",
  );
});

test("an Org space-lua block reports its language as a context", () => {
  // `onlyContexts: [FencedCode:space-lua]` gates nine slash commands in the
  // shipped library. Reading the language by trimming three characters off a
  // `#+BEGIN_SRC` block left `EGIN_SRC space-lua`, so every one of those
  // gates failed in an Org page -- silently, since a gate that matches
  // nothing just hides the command.
  expect(contextsAt(orgBlock, "x = 1", "org")).toContain(
    "FencedCode:space-lua",
  );
});

test("the language is the whole context suffix, not the code after it", () => {
  // Matching is by prefix, so trailing code would still match -- but the
  // context is clearer, and a gate on an exact string works either way.
  const contexts = contextsAt(orgBlock, "x = 1", "org");
  expect(contexts).not.toContain("FencedCode:EGIN_SRC space-lua");
  expect(contexts.some((c) => c.includes("x = 1"))).toBe(false);
});

test("a fence with no language is still an unqualified code block", () => {
  for (const [doc, syntax] of [
    ["```\nplain\n```\n", "markdown"],
    ["#+BEGIN_EXAMPLE\nplain\n#+END_EXAMPLE\n", "org"],
  ] as const) {
    const contexts = contextsAt(doc, "plain", syntax);
    expect(contexts).toContain("FencedCode");
  }
});

test("a Lua directive reports its body, in either syntax", () => {
  for (const syntax of ["markdown", "org"] as const) {
    expect(contextsAt("${query[[from p]]}\n", "query", syntax)).toContain(
      "LuaDirective:query[[from p]]",
    );
  }
});

/**
 * The predicate the slash-command hook actually applies: a gate matches when
 * some parent context *starts with* it. Asserting through this rather than on
 * exact strings separates the real defect from a change of contract -- the old
 * character arithmetic still satisfied a Markdown gate by accident, because
 * the language happened to land first in the slice.
 */
const gateMatches = (contexts: string[], gate: string) =>
  contexts.some((context) => context.startsWith(gate));

test("a space-lua gate matches in both syntaxes", () => {
  expect(
    gateMatches(
      contextsAt(markdownBlock, "x = 1", "markdown"),
      "FencedCode:space-lua",
    ),
  ).toBe(true);
  // This is the one that was broken: an Org page offered none of the library's
  // space-lua slash commands, and suppressed none of the ones that should be
  // held back inside a code block.
  expect(
    gateMatches(contextsAt(orgBlock, "x = 1", "org"), "FencedCode:space-lua"),
  ).toBe(true);
});

test("a space-lua gate does not match a block in another language", () => {
  for (const [doc, syntax] of [
    ["```lua\nx = 1\n```\n", "markdown"],
    ["#+BEGIN_SRC lua\nx = 1\n#+END_SRC\n", "org"],
  ] as const) {
    expect(
      gateMatches(contextsAt(doc, "x = 1", syntax), "FencedCode:space-lua"),
    ).toBe(false);
    expect(gateMatches(contextsAt(doc, "x = 1", syntax), "FencedCode")).toBe(
      true,
    );
  }
});

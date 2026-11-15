import { expect, test } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { EditorState } from "@codemirror/state";
import { TaskList } from "../markdown_parser/extended_task.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { computeMarkerParts, listIndentPlugin } from "./list_indent.ts";

/**
 * A list item's left columns split in two, because they want opposite
 * treatment: `nest` indents the text, `marker` hangs in the margin so the
 * item's words start on the same edge as every other line's.
 *
 * A task's `[ ]` is in neither. It is a control you click and a qualifier of
 * the words after it, so it stays in the text column -- which is also where
 * Bear and iA Writer put one.
 */
const parts = (node: Parameters<typeof computeMarkerParts>[0]) => {
  const p = computeMarkerParts(node, 0);
  return p && { nest: p.nest, marker: p.marker };
};
import { blockquotePlugin } from "./block_quote.ts";

const parser = baseParser.configure([TaskList]);

// Parse a single-line markdown source and return its first ListItem node + line text.
function firstListItem(source: string): { node: SyntaxNode; source: string } {
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error(`no ListItem in: ${JSON.stringify(source)}`);
  return { node, source };
}

test("marker parts: plain unordered with *", () => {
  const { node } = firstListItem("* item");
  expect(parts(node)).toEqual({ nest: 0, marker: 2 });
});

test("marker parts: plain unordered with -", () => {
  const { node } = firstListItem("- item");
  expect(parts(node)).toEqual({ nest: 0, marker: 2 });
});

test("marker parts: nested unordered (2 leading spaces)", () => {
  const { node } = firstListItem("  * item");
  expect(parts(node)).toEqual({ nest: 2, marker: 2 });
});

test("marker parts: task at level 1", () => {
  const { node } = firstListItem("* [ ] task");
  expect(parts(node)).toEqual({ nest: 0, marker: 2 });
});

test("marker parts: task at level 2", () => {
  const { node } = firstListItem("  * [ ] task");
  expect(parts(node)).toEqual({ nest: 2, marker: 2 });
});

test("marker parts: multi-status task `[done]`", () => {
  const { node } = firstListItem("* [done] task");
  expect(parts(node)).toEqual({ nest: 0, marker: 2 });
});

test("marker parts: ordered single digit", () => {
  const { node } = firstListItem("1. item");
  expect(parts(node)).toEqual({ nest: 0, marker: 3 });
});

test("marker parts: ordered two digits", () => {
  const { node } = firstListItem("10. item");
  expect(parts(node)).toEqual({ nest: 0, marker: 4 });
});

test("marker parts: ordered three digits", () => {
  const { node } = firstListItem("100. item");
  expect(parts(node)).toEqual({ nest: 0, marker: 5 });
});

test("marker parts: ordered with task", () => {
  const { node } = firstListItem("1. [ ] task");
  expect(parts(node)).toEqual({ nest: 0, marker: 3 });
});

test("marker parts: deeply nested unordered (6 leading spaces)", () => {
  // 6 leading spaces only parses as a ListItem inside a proper nested list,
  // so build a 4-level structure and pick the deepest ListItem.
  const source = "* a\n  * b\n    * c\n      * d";
  const tree = parser.parse(source);
  let deepest: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem") deepest = n.node;
    },
  });
  if (!deepest) throw new Error("no ListItem");
  const lineStart = source.lastIndexOf("\n") + 1;
  const p = computeMarkerParts(deepest!, lineStart);
  expect(p && { nest: p.nest, marker: p.marker }).toEqual({
    nest: 6,
    marker: 2,
  });
});

test("marker parts: respect a non-zero lineStart", () => {
  // Two-line doc: first line is empty (or text), second line is "* item"
  const source = "intro\n* item";
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error("no ListItem");
  // Line start for the second line is at offset 6 (after "intro\n"), so the
  // nesting is measured from there rather than from the document start.
  const p = computeMarkerParts(node!, 6);
  expect(p && { nest: p.nest, marker: p.marker }).toEqual({
    nest: 0,
    marker: 2,
  });
});

function lineStylesFor(doc: string): string[] {
  const field = listIndentPlugin();
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage(), field],
  });
  const styles: string[] = [];
  state.field(field).between(0, doc.length, (_from, _to, deco) => {
    const style = (deco.spec as any).attributes?.style;
    if (style) styles.push(style);
  });
  return styles;
}

test("a list line contributes its nesting and its marker separately", () => {
  // Separately, because only one of the two indents the text: the nesting
  // moves the words, the marker hangs outside them.
  expect(lineStylesFor("* one\n")).toEqual([
    "--sb-list-nest:0ch;--sb-list-marker:2ch",
  ]);
});

test("a nested item contributes the innermost item's nesting", () => {
  // Outer then inner for the nested line; the inner one is added last and
  // therefore wins the concatenated style attribute. The marker stays one
  // marker wide at every depth -- nesting is what moves the text.
  expect(lineStylesFor("* one\n  * two\n")).toEqual([
    "--sb-list-nest:0ch;--sb-list-marker:2ch",
    "--sb-list-nest:0ch;--sb-list-marker:2ch",
    "--sb-list-nest:2ch;--sb-list-marker:2ch",
  ]);
});

// Guards the invariant the two plugins jointly maintain: a line's
// contributions must add up to the number of columns its leading markup
// actually occupies -- whether a given contribution indents the text or hangs
// outside it -- so a wrapped row lines up under the first row's words. Each plugin alone can't catch a regression
// where one starts double-counting what the other already reserves.
function summedIndentColumns(doc: string): number {
  const listField = listIndentPlugin();
  const quoteField = blockquotePlugin();
  const state = EditorState.create({
    doc,
    // Cursor parked outside the doc so no quote marker is revealed.
    selection: { anchor: doc.length },
    extensions: [buildExtendedMarkdownLanguage(), listField, quoteField],
  });
  const firstLineEnd = state.doc.line(1).to;
  let sum = 0;
  for (const field of [listField, quoteField]) {
    state.field(field).between(0, firstLineEnd, (_from, _to, deco) => {
      const style = (deco.spec as any).attributes?.style as string | undefined;
      // `--sb-list-nest:Nch;--sb-list-marker:Nch`, or a quote's
      // `--sb-quote-indent:calc(N * var(--editor-column))`. Every number in
      // the attribute counts: a list's two halves are an indent and a hang
      // now, and it is their sum that has to match the markup's width.
      // Named rather than "every number in the attribute": a quote also
      // carries `--sb-quote-bar-offset`, which says where to *draw* its bar
      // and reserves nothing. Counting that too is how this first read 8
      // columns for `  > * `, which occupies 6.
      for (const property of [
        "--sb-list-nest",
        "--sb-list-marker",
        "--sb-quote-indent",
        "--sb-inline-comment-indent",
      ]) {
        const m = style?.match(new RegExp(`${property}:(?:calc\\()?(\\d+)`));
        if (m) sum += Number(m[1]);
      }
    });
  }
  return sum;
}

test("list and quote contributions sum to the real leading-markup width", () => {
  const cases: [string, number][] = [
    ["* item", 2], // `* `
    ["> quoted", 2], // `> `
    ["> * item one", 4], // `> * `
    ["> 1. numbered", 5], // `> 1. `
    ["> > * deep", 6], // `> > * `
    [">   * spaced", 6], // `>   * `
    ["  > * indented", 6], // `  > * `
  ];
  for (const [line, expected] of cases) {
    expect(summedIndentColumns(`${line}\n`)).toBe(expected);
  }
});

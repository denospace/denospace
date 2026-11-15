import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { findMetadataBlock } from "./metadata_fold.ts";

const block = (doc: string) =>
  findMetadataBlock(EditorState.create({ doc }) as any);

/** The text the block covers, which is easier to read than two offsets. */
const covers = (doc: string) => {
  const found = block(doc);
  return found ? doc.slice(found.from, found.to) : undefined;
};

describe("findMetadataBlock", () => {
  test("covers the run of keywords and the blank line after it", () => {
    // The blank line is taken in on purpose: a fold leaves one line behind
    // wherever it sits, and taking the blank one with it means that line is
    // the gap above the prose rather than an extra one on top of it.
    expect(
      covers("#+title: A\n#+identifier: 20261115T090000\n\nProse.\n"),
    ).toBe("#+title: A\n#+identifier: 20261115T090000\n");
  });

  test("stops at the first line that is not a keyword", () => {
    expect(covers("#+title: A\nProse.\n#+title: B\n")).toBe("#+title: A");
  });

  test("leaves a note that is nothing but front matter alone", () => {
    // Folding it would hide the whole document, leaving nowhere to put the
    // caret and no way to start writing.
    expect(block("#+title: A")).toBeUndefined();
    expect(block("#+title: A\n#+identifier: 20261115T090000")).toBeUndefined();
    // One trailing newline is one blank line, which the block takes in --
    // and then there is nothing under it.
    expect(block("#+title: A\n")).toBeUndefined();
  });

  test("folds as soon as there is a line below to fold to", () => {
    // Which a new note has the moment it is written: the file ends in a
    // newline after its blank line, so there is an empty last line for the
    // caret to sit on, outside the fold.
    expect(covers("#+title: A\n\n")).toBe("#+title: A\n");
    expect(covers("#+title: A\n\n\n")).toBe("#+title: A\n");
  });

  test("ignores a document that does not open with a keyword", () => {
    expect(block("# Markdown\n\n#+title: A\n")).toBeUndefined();
    expect(block("Prose.\n")).toBeUndefined();
    expect(block("")).toBeUndefined();
    // `#+BEGIN_SRC` has no colon, so a block is not front matter.
    expect(block("#+BEGIN_SRC js\nconst a = 1;\n#+END_SRC\n")).toBeUndefined();
  });
});

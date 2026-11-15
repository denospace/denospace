import { foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import { EditorState, RangeSet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { Client } from "../client.ts";

/**
 * Folds a note's `#+key:` block away, so every note's prose starts at the
 * same height.
 *
 * Denote writes the title, the date, the identifier, the signature and the
 * keywords into the head of each file, and the top bar already shows the
 * ones a reader wants. Five lines saying it a second time is a lot of a
 * screen -- and worse, a *varying* amount, so the first line of prose sits
 * somewhere different in every note.
 *
 * Folded is a per-device setting rather than per note, which is the whole
 * point: a fold the reader has to keep re-making is a fold that keeps
 * moving the text.
 */

export type MetadataBlock = {
  from: number;
  to: number;
};

/** An Org keyword line: `#+key:`, with or without a value. */
const KEYWORD_LINE = /^#\+[^\s:]+:/;

/**
 * The run of `#+key:` lines a note opens with, if it opens with one, plus
 * the blank line that follows it.
 *
 * The blank line is taken in on purpose. A fold leaves one line behind
 * wherever it sits, and taking the blank one with it means that line *is*
 * the gap above the prose rather than an extra one on top of it.
 *
 * Read from the text rather than the syntax tree: this runs on every page
 * load, the tree may not be parsed that far yet, and the shape being looked
 * for is exactly the shape of the file's first lines.
 */
export function findMetadataBlock(
  state: EditorState,
): MetadataBlock | undefined {
  if (!KEYWORD_LINE.test(state.doc.line(1).text)) {
    return;
  }
  let last = 1;
  while (last < state.doc.lines) {
    if (!KEYWORD_LINE.test(state.doc.line(last + 1).text)) break;
    last++;
  }
  if (last < state.doc.lines && state.doc.line(last + 1).text.trim() === "") {
    last++;
  }
  // Nothing below it is nothing to fold *to*: a note that is all front
  // matter -- which is what a note is for its first few seconds -- would
  // hide itself entirely, leaving nowhere to put the caret and no way to
  // start writing. It folds as soon as there is a body.
  if (last >= state.doc.lines) {
    return;
  }
  return { from: state.doc.line(1).from, to: state.doc.line(last).to };
}

/** Whether a fold range is this document's metadata block. */
export function isMetadataRange(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  const block = findMetadataBlock(state);
  return !!block && block.from === range.from && block.to === range.to;
}

/** Whether any selection range sits inside the block. */
export function selectionInside(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from >= from && range.from <= to
      : range.from <= to && range.to >= from,
  );
}

/**
 * Where the cursor goes when the block it was in is folded away: the start
 * of the line after it, which is where a note's body begins.
 *
 * A page opens with the cursor at position 0, which is inside the block --
 * so a fold that stood aside for the cursor would never happen at all. It
 * takes the cursor with it instead.
 */
export function positionAfter(state: EditorState, to: number): number {
  return Math.min(to + 1, state.doc.length);
}

/** Whether a fold already covers the whole of `from`..`to`. */
export function isFolded(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  let covered = false;
  foldedRanges(state).between(from, to, (rangeFrom, rangeTo) => {
    if (rangeFrom <= from && rangeTo >= to) {
      covered = true;
      return false;
    }
  });
  return covered;
}

/**
 * Keeps the caret out of a folded block.
 *
 * Folding hides the text; it does not take the positions away, and a caret
 * left among them is a caret in text nobody can see. The keys make that
 * plain: HOME puts the caret on the hidden first line, and TAB there is
 * `org-cycle`, which finds the fold it is standing in and opens it -- so
 * pressing TAB at the top of a note edited the metadata.
 *
 * An atomic range moves any selection that lands inside it to the edge,
 * which covers the lot: clicks, HOME, arrow keys, and every command that
 * works from where the caret is.
 */
const caretOutOfTheFold = EditorView.atomicRanges.of((view) => {
  const block = findMetadataBlock(view.state);
  if (!block || !isFolded(view.state, block.from, block.to)) {
    return RangeSet.empty;
  }
  return RangeSet.of([Decoration.replace({}).range(block.from, block.to)]);
});

/**
 * The same thing again, for every other way a caret gets somewhere.
 *
 * `atomicRanges` is consulted in three places only -- a pointer-driven
 * selection, cursor motion, and drawing the selection -- so HOME still put
 * the caret on the hidden first line, and TAB there is `org-cycle`, which
 * found the fold it was standing in and opened it. A filter sees every
 * transaction that sets a selection, whatever asked for it.
 */
const keepCaretOut = EditorState.transactionFilter.of((tr) => {
  // A transaction that also edits moves the positions under us, and the
  // fold's own transactions are what put the caret right in the first place.
  if (!tr.selection || tr.docChanged) return tr;
  const block = findMetadataBlock(tr.startState);
  if (!block || !isFolded(tr.startState, block.from, block.to)) return tr;
  const inside = tr.newSelection.ranges.some(
    (range) => range.from <= block.to && range.to >= block.from,
  );
  if (!inside) return tr;
  const anchor = positionAfter(tr.startState, block.to);
  // Refuse rather than loop, if there turns out to be nowhere outside it.
  if (anchor <= block.to) return tr;
  return [tr, { selection: { anchor }, sequential: true }];
});

export function metadataFoldingExtension(client: Client): Extension {
  return [caretOutOfTheFold, keepCaretOut, metadataFoldPlugin(client)];
}

function metadataFoldPlugin(client: Client): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;
      /**
       * Set once the reader opens the block themselves. Renaming a note
       * rewrites its front matter, which replaces the folded range and so
       * drops the fold -- the block would spring open mid-sentence, which is
       * exactly the jumping around the fold exists to stop. So it is put
       * back; but not over someone who asked to see it.
       */
      private opened = false;

      constructor(private view: EditorView) {
        // After the first render, so the fold lands on a state the view has
        // already measured -- the same thing the Markdown front matter fold
        // does, and for the same reason.
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.fold();
        });
      }

      update(update: ViewUpdate): void {
        // This runs on every keystroke, so the two settings that make the
        // rest of it pointless are read first.
        if (this.opened) return;
        if (!client.ui.viewState.uiOptions.foldMetadata) return;

        const unfolds = update.transactions.flatMap((tr) =>
          tr.effects.filter((effect) => effect.is(unfoldEffect)),
        );
        if (unfolds.length > 0) {
          const block = findMetadataBlock(update.state);
          if (
            block &&
            unfolds.some(
              (effect) =>
                effect.value.from <= block.to && effect.value.to >= block.from,
            )
          ) {
            this.opened = true;
            return;
          }
        }

        if (!update.docChanged) return;
        const block = findMetadataBlock(update.state);
        if (!block) return;
        if (isFolded(update.state, block.from, block.to)) return;
        if (selectionInside(update.state, block.from, block.to)) return;
        // Out of the update cycle: a dispatch from inside `update` is an
        // error in CodeMirror.
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.fold();
        });
      }

      destroy(): void {
        this.destroyed = true;
      }

      private fold(): void {
        if (!client.ui.viewState.uiOptions.foldMetadata) return;
        const state = this.view.state;
        const block = findMetadataBlock(state);
        if (!block) return;
        if (isFolded(state, block.from, block.to)) return;
        const anchor = positionAfter(state, block.to);
        this.view.dispatch({
          effects: foldEffect.of({ from: block.from, to: block.to }),
          // A cursor left inside a folded range would be typing into text
          // nobody can see.
          selection: selectionInside(state, block.from, block.to)
            ? { anchor }
            : undefined,
        });
      }
    },
  );
}

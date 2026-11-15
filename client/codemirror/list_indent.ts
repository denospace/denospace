import type { SyntaxNode } from "@lezer/common";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

/**
 * Compute the marker-zone width in source columns (== `ch` units) for a
 * single ListItem node.
 * @param listItem     The `ListItem` syntax node.
 * @param lineStart    Absolute offset of the line this list-item starts on.
 * @param quoteColumns Columns a blockquote marker run already reserves on
 *                     this line, subtracted so the two never double-count.
 */
export function computeMarkerWidth(
  listItem: SyntaxNode,
  lineStart: number,
  quoteColumns = 0,
): number {
  const parts = computeMarkerParts(listItem, lineStart, quoteColumns);
  return parts ? parts.nest + parts.marker : 0;
}

/**
 * The two halves of a list item's left-hand columns, which want opposite
 * treatment.
 *
 * `nest` is how far this item is nested -- real structure, and it indents the
 * text. `marker` is the bullet or number and its trailing space, which is not
 * text at all: it belongs in the margin, so the item's words start where
 * every other line's words start. Lumping the two together is why a list used
 * to sit a marker's width right of its own prose.
 */
export function computeMarkerParts(
  listItem: SyntaxNode,
  lineStart: number,
  quoteColumns = 0,
): { nest: number; marker: number; from: number; to: number } | null {
  const mark = listItem.firstChild;
  if (!mark || mark.name !== "ListMark") {
    return null;
  }
  const nest = mark.from - lineStart - quoteColumns;
  const markLength = mark.to - mark.from;
  // TaskState wraps `[X]` / `[done]` / etc. (length varies by status string).
  // Width contribution = TaskState range length + 1 for the trailing space.
  // A task's `[ ]` is deliberately *not* part of the marker. It is a control
  // you click, it belongs beside the words it qualifies, and keeping it in
  // the text column is also how Bear and iA Writer show one.
  return {
    nest,
    marker: markLength + 1,
    // The run to box: the mark and its trailing space.
    from: mark.from,
    to: mark.to + 1,
  };
}

/**
 * Contribute a per-line `--sb-list-indent` for every line owned by a ListItem,
 * using `computeMarkerWidth` to derive the value from source. The `.cm-line`
 * rule in editor.scss sums it with the other indent contributions.
 *
 * Nested list lines: when we iterate the syntax tree, outer ListItems are
 * visited before their nested children. CodeMirror concatenates same-position
 * line decorations' `style` attributes with `;`, and the last declaration of
 * a given property wins — so the inner item's (deeper) marker width
 * overwrites the outer item's for the nested portion. This is the behaviour
 * we want: every line gets the marker width of the innermost ListItem it
 * belongs to.
 */
export function listIndentPlugin() {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    const doc = state.doc;
    const quoteMarkupStart = new Map<number, number>();
    const quoteMarkupEnd = new Map<number, number>();
    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        if (type.name === "QuoteMark") {
          // Matches block_quote.ts's rule exactly: the trailing space
          // belongs to the marker.
          const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
          const lineStart = doc.lineAt(from).from;
          quoteMarkupStart.set(
            lineStart,
            Math.min(quoteMarkupStart.get(lineStart) ?? from, from),
          );
          quoteMarkupEnd.set(
            lineStart,
            Math.max(quoteMarkupEnd.get(lineStart) ?? 0, end),
          );
          return;
        }
        if (type.name !== "ListItem") return;
        // QuoteMark precedes ListItem in document order on the same line, so
        // the maps above are already populated by the time we get here.
        const startLine = doc.lineAt(from);
        const quoteColumns = quoteMarkupEnd.has(startLine.from)
          ? quoteMarkupEnd.get(startLine.from)! -
            quoteMarkupStart.get(startLine.from)!
          : 0;
        const parts = computeMarkerParts(node, startLine.from, quoteColumns);
        if (!parts || parts.nest + parts.marker <= 0) return;
        // An ordered marker is literal text, so it is boxed here to exactly
        // the columns the line hangs back by -- which is what puts `1.` and
        // `10.` in one column. An *unordered* mark is replaced by the bullet
        // widget, which renders outside any mark decoration over the same
        // range, so boxing it here would wrap the trailing space and nothing
        // else; `.cm-list-bullet` is normalised in CSS instead.
        const markText = doc.sliceString(parts.from, parts.from + 1);
        const unordered = "-+*".includes(markText);
        if (parts.to <= startLine.to) {
          widgets.push(
            // Unordered: the mark is replaced by the bullet widget, which
            // renders outside a mark decoration over the same range -- so
            // only the trailing space is boxed here, and `.cm-list-bullet`
            // takes the column the mark occupied. Ordered: the whole run is
            // literal text and is boxed as one.
            //
            // The space has to be boxed at all because it is a real
            // character, and a space is narrower than `ch` in a proportional
            // font: left to itself it leaves the text short of the edge.
            unordered
              ? Decoration.mark({ class: "sb-list-space" }).range(
                  parts.to - 1,
                  parts.to,
                )
              : Decoration.mark({ class: "sb-list-marker" }).range(
                  parts.from,
                  parts.to,
                ),
          );
        }
        const styleAttr = `--sb-list-nest:${parts.nest}ch;--sb-list-marker:${parts.marker}ch`;
        const endLine = doc.lineAt(to);
        for (
          let lineNo = startLine.number;
          lineNo <= endLine.number;
          lineNo++
        ) {
          const line = doc.line(lineNo);
          widgets.push(
            Decoration.line({
              attributes: { style: styleAttr },
            }).range(line.from),
          );
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}

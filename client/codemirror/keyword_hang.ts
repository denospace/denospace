import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

/**
 * Hangs an Org keyword's `#+key:` in the left margin, so its **value** starts
 * where every other line's text starts.
 *
 * Same arrangement as a heading's stars and a list's bullet: what is markup
 * goes in the margin, what is content sits in the text column. Denote already
 * pads these lines so the values line up with each other -- this is what
 * lines them up with the prose below as well.
 *
 * The run hangs at its natural width rather than being right-aligned to a
 * fixed column: `#+identifier:` is half again as long as `#+title:`, and
 * forcing them into one box would either clip the longer or strand the
 * shorter. Left-aligned in the margin, every value still lands on the edge,
 * which is the part that matters.
 */
export function keywordHangPlugin() {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, node }) => {
        if (type.name !== "OrgKeyword") return;
        const line = state.doc.lineAt(from);
        // Only a line that *is* the keyword: an inline `#+` inside a block
        // has no margin to hang into.
        if (line.from !== from) return;
        const value = node.getChild("OrgKeywordValue");
        // Where the value begins, or -- for a keyword with no value -- the end
        // of the run, so an empty `#+filetags:` hangs like its neighbours
        // instead of jumping back into the column.
        const marks = node.getChildren("OrgKeywordMark");
        const colon = marks.length ? marks[marks.length - 1].to : node.to;
        const valueFrom = value
          ? value.from
          : lastNonSpace(state, colon, line.to);
        const columns = valueFrom - line.from;
        if (columns <= 0) return;
        widgets.push(
          Decoration.line({
            attributes: { style: `--sb-keyword-hang:${columns}ch` },
          }).range(line.from),
        );
        widgets.push(
          Decoration.mark({ class: "sb-keyword-hang" }).range(
            line.from,
            valueFrom,
          ),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}

/**
 * Past the colon, skipping the padding Denote writes. Used when a keyword has
 * no value: the run then ends where a value would have started, so an empty
 * line hangs by the same amount as a full one.
 */
function lastNonSpace(
  state: { doc: { sliceString: (a: number, b: number) => string } },
  from: number,
  to: number,
): number {
  const text = state.doc.sliceString(from, to);
  const match = /^[ \t]*/.exec(text);
  return from + (match ? match[0].length : 0);
}

import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

/**
 * Hangs an Org keyword's leading `#+` in the left margin, so the key starts
 * where every other line's text starts.
 *
 * Same arrangement as a heading's stars and a list's bullet: the sigil that
 * says what kind of line this is goes in the margin, and the line itself
 * sits in the text column. Only the `#+` goes -- `title:` is part of what
 * the line says, not punctuation announcing it, and Denote's padding already
 * lines the values up with each other.
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
        // The run's marks are `#+` and the closing `:`; the first is the one
        // that belongs in the margin.
        const sigil = node.getChildren("OrgKeywordMark")[0];
        if (!sigil || sigil.from !== line.from) return;
        const columns = sigil.to - line.from;
        if (columns <= 0) return;
        widgets.push(
          Decoration.line({
            attributes: { style: `--sb-keyword-hang:${columns}ch` },
          }).range(line.from),
        );
        widgets.push(
          Decoration.mark({ class: "sb-keyword-hang" }).range(
            line.from,
            sigil.to,
          ),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}

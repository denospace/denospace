import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * The context names a slash command's `onlyContexts`/`exceptContexts` are
 * matched against: every node from `node` up to the document root, innermost
 * first. Matching is by prefix, so a template asks for `FencedCode` to mean
 * any code block and `FencedCode:space-lua` to mean one in that language.
 *
 * The language comes from the block's `CodeInfo` child rather than from
 * counting characters off the ends. A Markdown block is fenced with three
 * backticks, so trimming three characters used to leave the language first in
 * the slice -- but an Org block opens with `#+BEGIN_SRC space-lua` and closes
 * with `#+END_SRC`, and the same arithmetic yields `EGIN_SRC space-lua`, which
 * matches nothing. Both syntaxes carry the language in `CodeInfo`, so reading
 * that works for either and stops the Org library's nine `FencedCode:space-lua`
 * gates from silently failing.
 */
export function extractParentContexts(
  editorState: EditorState,
  node: SyntaxNode | null,
): string[] {
  const contexts: string[] = [];
  for (let current = node; current; current = current.parent) {
    contexts.push(contextFor(editorState, current));
  }
  return contexts;
}

function contextFor(editorState: EditorState, node: SyntaxNode): string {
  if (node.name === "FencedCode") {
    const info = node.getChild("CodeInfo");
    // A fence with no language is still a code block, just an unqualified one.
    return info
      ? `FencedCode:${editorState.sliceDoc(info.from, info.to).trim()}`
      : "FencedCode";
  }
  if (node.name === "FrontMatter") {
    return `FrontMatter:${editorState.sliceDoc(node.from + 3, node.to - 3)}`;
  }
  if (node.name === "LuaDirective") {
    return `LuaDirective:${editorState.sliceDoc(node.from + 2, node.to - 1)}`;
  }
  return node.name;
}

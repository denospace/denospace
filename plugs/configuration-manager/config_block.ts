export const MANAGED_MARKER = "-- managed-by: configuration-manager";

/** Which markup a config page is written in, which decides how a block is spelled. */
export type PageSyntax = "markdown" | "org";

export interface ManagedBlock {
  /** Start index of the opening fence line in the full text */
  start: number;
  /** End index (exclusive) of the closing fence line */
  end: number;
  /** The content inside the fences (without the fences themselves) */
  innerContent: string;
  /** The markup this block was found in, so a rewrite stays in it. */
  syntax: PageSyntax;
  /** The block's own opening and closing lines, reused verbatim on a rewrite. */
  open: string;
  close: string;
}

/**
 * A space-lua block, in either markup. Fresh regexes each call: these are
 * `g`-flagged, and a shared one would carry `lastIndex` between searches.
 *
 * Org is matched case-insensitively because `#+begin_src` and `#+BEGIN_SRC`
 * are the same block to Org, and whichever the page used is what gets written
 * back -- the opening and closing lines are captured rather than regenerated,
 * so hand-written casing and indentation survive a round trip through the UI.
 */
function blockPatterns(): { syntax: PageSyntax; regex: RegExp }[] {
  return [
    {
      syntax: "markdown",
      regex: /^(```space-lua[ \t]*)\n([\s\S]*?)^(```[ \t]*)$/gm,
    },
    {
      syntax: "org",
      regex:
        /^([ \t]*#\+begin_src[ \t]+space-lua[^\n]*)\n([\s\S]*?)^([ \t]*#\+end_src[ \t]*)$/gim,
    },
  ];
}

/** Every space-lua block in the text, in the order they appear. */
function findBlocks(text: string): ManagedBlock[] {
  const blocks: ManagedBlock[] = [];
  for (const { syntax, regex } of blockPatterns()) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        open: match[1],
        innerContent: match[2],
        close: match[3],
        syntax,
      });
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/**
 * Find the managed space-lua block in a config page, in either markup.
 * Returns null if no managed block exists.
 */
export function findManagedBlock(text: string): ManagedBlock | null {
  return (
    findBlocks(text).find((block) =>
      block.innerContent.trimStart().startsWith(MANAGED_MARKER),
    ) ?? null
  );
}

/** The opening and closing lines a newly appended block gets. */
function markersFor(syntax: PageSyntax): { open: string; close: string } {
  return syntax === "org"
    ? { open: "#+BEGIN_SRC space-lua", close: "#+END_SRC" }
    : { open: "```space-lua", close: "```" };
}

/**
 * Replace the managed block in a config page, or append one if none exists.
 * If newContent is empty, the managed block is removed.
 *
 * `syntax` is the markup of the page being written, and is used only when
 * appending: an existing block is rewritten with its own markers, so a block
 * is never converted out from under the page it lives in.
 */
export function replaceManagedBlock(
  text: string,
  newContent: string,
  syntax: PageSyntax = "markdown",
): string {
  const existing = findManagedBlock(text);

  if (existing) {
    if (!newContent) {
      // Remove the block and any surrounding blank line
      let end = existing.end;
      if (text[end] === "\n") end++;
      let start = existing.start;
      if (start > 0 && text[start - 1] === "\n") start--;
      return text.slice(0, start) + text.slice(end);
    }
    const replacement = `${existing.open}\n${newContent}\n${existing.close}`;
    return (
      text.slice(0, existing.start) + replacement + text.slice(existing.end)
    );
  }

  if (!newContent) return text;

  // Append new block at end
  const { open, close } = markersFor(syntax);
  const block = `${open}\n${newContent}\n${close}\n`;
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return text + separator + block;
}

/** The markup a config page is written in, from its path. */
export function syntaxForPath(path: string): PageSyntax {
  return path.toLowerCase().endsWith(".org") ? "org" : "markdown";
}

/**
 * `denote-org-extract-org-subtree`: lift a heading's section out into a note
 * of its own.
 *
 * Denote reads the new note's title off the heading, its keywords off the
 * heading's tags (falling back to the file's), and its date off a DATE,
 * CREATED or CLOSED stamp, and asks only for what the heading does not say.
 * That is what this does. Three things differ on purpose, each noted where it
 * happens below: a link is left behind, the whole subtree comes along rather
 * than only the text above the first subheading, and the new note's file type
 * follows the page it came from rather than always being Org.
 */
import {
  type DenoteFileType,
  denoteFileType,
  denoteLinkDescription,
} from "@silverbulletmd/silverbullet/lib/denote";
import {
  type LinkSyntax,
  linkSyntaxFor,
  pageLink,
  urlLink,
} from "@silverbulletmd/silverbullet/lib/link_syntax";
import {
  getPathExtension,
  type Path,
  pathFromPageName,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { editor, markdown, space } from "@silverbulletmd/silverbullet/syscalls";
import {
  type DenotePromptName,
  denoteMetadata,
  openNewNote,
  promptForNewNote,
} from "./denote.ts";

/** A heading and everything under it, with what the heading says about itself. */
export type Subtree = {
  /** The heading's level, 1 to 6. */
  level: number;
  /** The heading text, with the marker, keyword, priority and tags removed. */
  title: string;
  /** The tags written on the heading itself. */
  keywords: string[];
  /** The moment a DATE, CREATED or CLOSED stamp puts the heading at. */
  date?: Date;
  /** The first character of the heading. */
  from: number;
  /** One past the subtree's last non-blank character. */
  to: number;
  /**
   * Everything below the heading line, with nested headings promoted so the
   * shallowest of them sits at level 1.
   */
  body: string;
};

const todoTypes = new Set(["OrgTodoKeyword", "OrgDoneKeyword"]);

/**
 * Org writes a heading's tags at the end of the line, between colons, and
 * allows word characters plus `@#%` in each.
 */
const orgHeadingTags = /\s+:([\w@#%]+(?::[\w@#%]+)*):[ \t]*$/;

/** Org's priority cookie, which belongs to neither the title nor the tags. */
const orgPriority = /^\s*\[#[A-Za-z0-9]\]\s*/;

/** The title and keywords a heading node carries. */
export function headingParts(heading: ParseTree): {
  title: string;
  keywords: string[];
} {
  const keywords: string[] = [];
  let raw = "";
  for (const child of heading.children ?? []) {
    if (child.type === "HeaderMark" || todoTypes.has(child.type ?? "")) {
      continue;
    }
    // A Markdown heading's tags are hashtags in the line; an Org heading's are
    // plain text, handled below.
    if (child.type === "Hashtag") {
      keywords.push(renderToText(child).replace(/^#/, ""));
      continue;
    }
    raw += renderToText(child);
  }
  const tagged = raw.match(orgHeadingTags);
  if (tagged) {
    keywords.push(...tagged[1].split(":").filter(Boolean));
    raw = raw.slice(0, tagged.index);
  }
  return {
    title: raw.replace(orgPriority, "").trim(),
    keywords: [...new Set(keywords)],
  };
}

/** The level of an `ATXHeadingN` node, or 0 for anything else. */
function headingLevel(node: ParseTree): number {
  const match = /^ATXHeading([1-6])$/.exec(node.type ?? "");
  return match ? +match[1] : 0;
}

/**
 * Reads an Org timestamp as a moment. Org writes `[2024-03-04 Mon 09:00]` or
 * `<2024-03-04 Mon>`; a stamp with no time is taken at midnight, as Denote
 * takes it.
 */
export function parseOrgTimestamp(value: string): Date | undefined {
  const match = /(\d{4})-(\d{2})-(\d{2})(?:\D+(\d{1,2}):(\d{2}))?/.exec(value);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    +year,
    +month - 1,
    +day,
    hour ? +hour : 0,
    minute ? +minute : 0,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The date a heading puts itself at: a DATE or CREATED property, or a CLOSED
 * stamp, in Denote's order of preference.
 *
 * Only the lines between the heading and the first thing that is neither a
 * planning line nor a properties drawer are read, so a nested heading's own
 * drawer is never mistaken for this one's.
 */
export function headingDate(leader: string): Date | undefined {
  const closed = /^[ \t]*CLOSED:\s*[[<]([^\]>]+)[\]>]/m.exec(leader);
  const properties: Record<string, string> = {};
  const drawer = /^[ \t]*:PROPERTIES:[ \t]*$([\s\S]*?)^[ \t]*:END:/m.exec(
    leader,
  );
  if (drawer) {
    for (const line of drawer[1].split("\n")) {
      const property = /^[ \t]*:([^:\s]+):[ \t]*(.*?)[ \t]*$/.exec(line);
      if (property) {
        properties[property[1].toUpperCase()] = property[2];
      }
    }
  }
  for (const value of [properties.DATE, properties.CREATED, closed?.[1]]) {
    const date = value && parseOrgTimestamp(value);
    if (date) {
      return date;
    }
  }
  return undefined;
}

/**
 * The text below a heading line, with nested headings promoted so the
 * shallowest sits at level 1.
 *
 * Denote carries only the text above the first subheading, because that is
 * what `org-get-entry` returns -- which means a subtree with children loses
 * them, since the whole subtree is deleted either way. Taking all of it is the
 * difference between extracting a section and destroying one. The marker is
 * read from each heading rather than assumed, because Markdown writes `#`,
 * Org writes `*`, and both parse to `ATXHeadingN`.
 */
function promotedBody(
  text: string,
  headings: ParseTree[],
  bodyFrom: number,
  bodyTo: number,
  level: number,
): string {
  let body = "";
  let pos = bodyFrom;
  for (const heading of headings) {
    const childLevel = headingLevel(heading);
    if (heading.from! < bodyFrom || heading.to! > bodyTo || !childLevel) {
      continue;
    }
    const mark = text.charAt(heading.from!);
    body += text.slice(pos, heading.from!);
    body += mark.repeat(Math.max(1, childLevel - level));
    // Past its own markers, the heading line is unchanged.
    pos = heading.from! + childLevel;
  }
  body += text.slice(pos, bodyTo);
  return body;
}

/**
 * The subtree `pos` falls in: the nearest heading at or above it, and
 * everything down to the next heading of the same level or shallower.
 *
 * Returns undefined when nothing above `pos` is a heading, which is the one
 * case Denote also refuses.
 */
export function subtreeAt(
  text: string,
  tree: ParseTree,
  pos: number,
): Subtree | undefined {
  const headings = (tree.children ?? []).filter((n) => headingLevel(n) > 0);
  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].from! <= pos) {
      index = i;
    } else {
      break;
    }
  }
  if (index === -1) {
    return undefined;
  }
  const heading = headings[index];
  const level = headingLevel(heading);
  let end = text.length;
  for (let i = index + 1; i < headings.length; i++) {
    if (headingLevel(headings[i]) <= level) {
      end = headings[i].from!;
      break;
    }
  }
  // The blank lines after a section belong to the page, not to the section, so
  // the link that replaces it lands with its surroundings intact.
  const to = text.slice(0, end).replace(/\s+$/, "").length;
  const bodyFrom = Math.min(heading.to! + 1, to);
  const { title, keywords } = headingParts(heading);
  return {
    level,
    title,
    keywords,
    date: headingDate(text.slice(bodyFrom, Math.min(bodyFrom + 2000, to))),
    from: heading.from!,
    to,
    body: promotedBody(text, headings, bodyFrom, to, level),
  };
}

/** The Denote file type to write, given the page the text came from. */
export function extractedFileType(path: Path, text: string): DenoteFileType {
  // Denote always writes Org here, because in Emacs the heading it extracted
  // was always in an Org file. The body is in the source's syntax, so what
  // keeps it readable is following the source instead.
  const type = denoteFileType(`.${getPathExtension(path)}`, text);
  return type === "text" ? "markdown-yaml" : type;
}

/**
 * `Note: Extract`.
 *
 * With a selection, the selection is the extent and the title is asked for,
 * since a passage has no heading to name it. With none, the extent is the
 * subtree the cursor is in and the heading names it. Either way the text
 * leaves this page, which is what separates this from `Note: New from Region`
 * -- that one copies a passage into a note and leaves it where it is.
 */
export async function extractNoteCommand(): Promise<void> {
  const path = await editor.getCurrentPath();
  const text = await editor.getText();
  const selection = await editor.getSelection();

  let from = selection.from;
  let to = selection.to;
  let title = "";
  let keywords: string[] = [];
  let date: Date | undefined;
  let body: string;

  if (from !== to) {
    body = text.slice(from, to);
    if (!body.trim()) {
      await editor.flashNotification("Nothing selected to extract", "error");
      return;
    }
    // A selection that opens with a heading has a title to offer, which is
    // what `Page: Extract` used it for.
    const heading = /^[ \t]*[#*]{1,6}\s+([^\n]*)/.exec(body);
    title = heading ? heading[1].trim() : "";
  } else {
    const subtree = subtreeAt(text, await markdown.parsePage(path, text), from);
    if (!subtree) {
      await editor.flashNotification(
        "Put the cursor under a heading, or select the text to extract",
        "error",
      );
      return;
    }
    ({ title, keywords, date, from, to } = subtree);
    body = subtree.body;
  }

  const syntax = linkSyntaxFor(path);
  const metadata = denoteMetadata(path, text);
  if (!metadata) {
    // Not a note in the library, so extracting from it cannot mint one: a
    // stock Markdown space keeps the behaviour it had.
    await extractToPage(from, to, title, body, syntax);
    return;
  }

  // Org's file tags are inherited by its headings, so a heading that names no
  // tags of its own carries the note's.
  if (keywords.length === 0) {
    keywords = metadata.keywords;
  }
  const answered: DenotePromptName[] = ["file-type", "template"];
  if (title) {
    answered.push("title");
  }
  if (keywords.length > 0) {
    answered.push("keywords");
  }
  if (date) {
    answered.push("date");
  }
  const created = await promptForNewNote({
    defaultTitle: title,
    body: body.endsWith("\n") ? body : `${body}\n`,
    seed: { keywords, date, fileType: extractedFileType(path, text) },
    answered,
  });
  if (!created) {
    return;
  }
  // Denote leaves nothing behind. A link is left here because a library
  // addressed by identifier is held together by its links, and the identifier
  // is what survives the new note being renamed.
  await editor.replaceRange(
    from,
    to,
    urlLink(
      syntax,
      `denote:${created.identifier}`,
      denoteLinkDescription(created),
    ),
  );
  await openNewNote(created.name, created.tailOffset);
}

/**
 * The same extraction on a page outside the library: a plain page named by the
 * title, which is what `Page: Extract` did.
 */
async function extractToPage(
  from: number,
  to: number,
  title: string,
  body: string,
  syntax: LinkSyntax,
): Promise<void> {
  const name = (
    await editor.prompt("New page title:", title || "new page")
  )?.trim();
  if (!name) {
    return;
  }
  const path = pathFromPageName(name);
  if (await space.fileExists(path)) {
    await editor.flashNotification(`${name} already exists`, "error");
    return;
  }
  await editor.replaceRange(from, to, pageLink(syntax, name));
  await space.writePage(name, body);
  await editor.navigate({ path });
}

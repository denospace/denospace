import {
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";
import YAML from "js-yaml";

/** A page's `#+key:` lines, split into page tags and everything else. */
export type OrgFrontMatter = {
  attributes: Record<string, any>;
  tags: string[];
};

/**
 * `#+filetags: :a:b:` is Denote's and Org's own spelling. `:a:b:`, `a b` and
 * `a, b` are all accepted, because a hand-written page rarely gets the colons
 * exactly right and the cost of being lenient here is nil.
 */
export function parseOrgTagList(value: string): string[] {
  return value
    .split(/[:,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter((tag) => tag.length > 0);
}

/**
 * A keyword's value, read the way an attribute's is: as YAML when that yields
 * something richer than text, and as plain text otherwise. `raw: true` has to
 * arrive as a boolean for the template machinery, and `["a", "b"]` as a list --
 * but `Insert a fenced code block` is prose and must survive verbatim, which a
 * failed YAML parse would otherwise turn into an error.
 */
function parseKeywordValue(raw: string): any {
  if (raw === "") {
    return "";
  }
  try {
    const parsed = cleanupJSON(YAML.load(raw));
    // YAML reads `a: b` as a map and `- a` as a list; a keyword line is one
    // value, so anything that came back structured from prose is a misread.
    // Objects are the risk here -- a colon in a sentence is common.
    if (
      parsed === null ||
      (typeof parsed === "object" && !Array.isArray(parsed))
    ) {
      return raw;
    }
    return parsed;
  } catch {
    return raw;
  }
}

/**
 * Org's own keywords are case-insensitive -- `#+TITLE:` and `#+title:` are the
 * same line -- but a SilverBullet front-matter key is camelCase, and
 * `exceptContexts` lowercased is a key nothing reads. So Org's keywords are
 * folded to lower case and everything else is kept exactly as written, which
 * leaves `#+TITLE:` and `#+exceptContexts:` both arriving where they are
 * looked for.
 */
const orgOwnKeywords = new Set([
  "author",
  "category",
  "date",
  "description",
  "email",
  "filetags",
  "identifier",
  "keywords",
  "language",
  "options",
  "priorities",
  "property",
  "seq_todo",
  "signature",
  "startup",
  "subtitle",
  "tags",
  "title",
  "todo",
  "typ_todo",
]);

function canonicalKeywordName(written: string): string {
  const lower = written.toLowerCase();
  // All-caps is Org's traditional style for any keyword, so `#+MYKEY:` folds
  // too; a name that was written with any lower case keeps its shape.
  return orgOwnKeywords.has(lower) || written === written.toUpperCase()
    ? lower
    : written;
}

/**
 * The `#+key: value` lines of an Org page, as front matter.
 *
 * Org has no list syntax, so a keyword given more than once accumulates into
 * one -- which is how `#+exceptContexts:` states two contexts without
 * resorting to YAML flow syntax inside an Org file.
 *
 * Every top-level keyword counts, wherever it sits. Org's own `#+TITLE:` is
 * document-wide regardless of position, and a page that states one halfway
 * down means it just as much as one that leads with it.
 */
export function collectOrgFrontMatter(tree: ParseTree): OrgFrontMatter {
  const collected = new Map<string, any[]>();
  const tags: string[] = [];

  const walk = (node: ParseTree) => {
    if (node.type === "OrgKeyword") {
      const nameNode = findNodeOfType(node, "OrgKeywordName");
      const valueNode = findNodeOfType(node, "OrgKeywordValue");
      const written = nameNode ? renderToText(nameNode).trim() : "";
      const name = written ? canonicalKeywordName(written) : "";
      const value = valueNode ? renderToText(valueNode).trim() : "";
      if (name) {
        if (name === "filetags" || name === "tags") {
          tags.push(...parseOrgTagList(value));
        } else {
          const values = collected.get(name) ?? [];
          values.push(parseKeywordValue(value));
          collected.set(name, values);
        }
      }
      return;
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(tree);

  const attributes: Record<string, any> = {};
  for (const [name, values] of collected) {
    attributes[name] = values.length === 1 ? values[0] : values;
  }
  return { attributes, tags };
}

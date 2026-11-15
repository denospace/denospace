import { parseDenoteName } from "@silverbulletmd/silverbullet/lib/denote";

/**
 * What to call a page in the browser's tab.
 *
 * A Denote file name is four facts run together -- identifier, signature,
 * title, keywords -- which is the right trade on disk and the wrong one in a
 * tab, where there is room for about three words and they had better be the
 * ones that say which note this is.
 *
 * The indexed title is the front matter's own `#+title:`, so it keeps its
 * capitals. The file name's title is a slug and is the fallback: the index
 * is a cache, and a note opened on a cold start or one created a moment ago
 * may not be in it yet. A page that is not a Denote note at all keeps its
 * name, which for those is already what it is called.
 */
export function pageTitle(
  name: string,
  meta?: { title?: unknown; pageDecoration?: { prefix?: string } },
): string {
  const prefix = meta?.pageDecoration?.prefix ?? "";
  const indexed = typeof meta?.title === "string" ? meta.title.trim() : "";
  if (indexed) {
    return prefix + indexed;
  }
  const parsed = parseDenoteName(name);
  if (parsed?.title) {
    return prefix + parsed.title.replaceAll("-", " ");
  }
  return prefix + name;
}

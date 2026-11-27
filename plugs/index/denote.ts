import {
  compileDblockRegexp,
  type DblockParams,
  type DenoteFileType,
  denoteAttachmentName,
  denoteDate,
  denoteExtension,
  denoteFileType,
  denoteIdentifier,
  denoteIdentifierDate,
  denoteLinkDescription,
  denotePageName,
  formatDenoteFrontMatter,
  formatDenoteName,
  isDenoteNoteFile,
  isJournalEntryName,
  journalDateStamp,
  journalTitle,
  parseDblockParams,
  parseDenoteFrontMatter,
  parseDenoteName,
  parseLocalDate,
  sluggify,
} from "@silverbulletmd/silverbullet/lib/denote";
import {
  hasLinkScheme,
  innerPageLink,
  type LinkSyntax,
  linkFor,
  linkSyntaxFor,
  urlLink,
} from "@silverbulletmd/silverbullet/lib/link_syntax";
import { pathFromPageName } from "@silverbulletmd/silverbullet/lib/ref";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  editor,
  index,
  lua,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { FrontMatter } from "./frontmatter.ts";
import { batchRenameFiles } from "./refactor.ts";
import type { RelationObject } from "./relation.ts";
import { buildLineIndex, extractSnippet, orgLinkContext } from "./snippet.ts";
import { insertUrlLink } from "./web_link.ts";
import { pickEntry } from "./zotero.ts";

export type DenoteObject = ObjectValue<{
  tag: "denote";
  /** The Denote identifier, which is also this object's ref. */
  identifier: string;
  title: string;
  keywords: string[];
  signature?: string;
  /** The `#+date:` value, verbatim in the file's own notation. */
  date?: string;
  page: string;
  extension: string;
  pageLastModified: string;
}>;

export type DenoteMetadata = {
  identifier: string;
  title: string;
  keywords: string[];
  signature?: string;
  date?: string;
  extension: string;
};

/** Turns a file-name title slug back into something readable. */
function unslugTitle(slug: string): string {
  const spaced = slug.replaceAll("-", " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : spaced;
}

/**
 * The Denote metadata for a page, or null when its name does not follow the
 * scheme.
 *
 * The file name and the front matter can disagree — they do in ~4% of the
 * notes in the real libraries this was tested against, because editing one
 * does not rewrite the other outside of `denote-rename-file`. The file name
 * wins for anything identity-bearing (identifier, signature, keywords), since
 * that is what Denote's design makes authoritative and what links resolve
 * against. The front matter wins for the title, which is the only place the
 * un-sluggified, human version of it exists.
 */
export function denoteMetadata(
  pageName: string,
  text: string,
): DenoteMetadata | null {
  const name = parseDenoteName(pageName);
  if (!name?.identifier) {
    return null;
  }
  const frontMatter = parseDenoteFrontMatter(
    text,
    denoteFileType(name.extension, text),
  );
  return {
    identifier: name.identifier,
    title:
      frontMatter.title ??
      (name.title ? unslugTitle(name.title) : name.identifier),
    keywords: name.keywords.length ? name.keywords : frontMatter.keywords,
    signature: name.signature,
    date: frontMatter.date,
    extension: name.extension,
  };
}

/**
 * Denote metadata shaped as SilverBullet front matter, so a Denote note's
 * title and keywords flow into the page object and the tag index the same way
 * a Markdown page's YAML front matter does.
 */
export function denoteFrontMatter(
  pageName: string,
  text: string,
): FrontMatter | null {
  const metadata = denoteMetadata(pageName, text);
  if (!metadata) {
    return null;
  }
  return {
    title: metadata.title,
    // `displayName` is what the page picker, the fuzzy matcher and link
    // completion search alongside the file name — which is how a note becomes
    // findable by its human title rather than only by its slug.
    displayName: metadata.title,
    tags: metadata.keywords,
    identifier: metadata.identifier,
    ...(metadata.signature ? { signature: metadata.signature } : {}),
    ...(metadata.date ? { date: metadata.date } : {}),
  };
}

// A Denote link names an identifier, never a path — that is what lets a note be
// renamed without breaking inbound links — so resolving one needs the whole
// file list. Every Denote file name starts with its own identifier, so the map
// is built from names alone and needs no index lookups, which keeps it free of
// ordering problems during a full reindex.
let identifierMap: Map<string, string> | undefined;
let identifierMapBuiltAt = 0;
const identifierMapTtl = 5000;

/** Drops the cached identifier map; call when the file list changes. */
export function invalidateDenoteIdentifiers() {
  identifierMap = undefined;
}

async function denoteIdentifierMap(): Promise<Map<string, string>> {
  if (identifierMap && Date.now() - identifierMapBuiltAt < identifierMapTtl) {
    return identifierMap;
  }
  const map = new Map<string, string>();
  // Attachments are Denote files too: `denote-rename-file` names a PDF the same
  // way it names a note, and a `denote:` link may point at one. Listing them
  // beside the notes is also what keeps an identifier unique across the whole
  // library rather than only among its notes. Pages go first so that when a
  // note and an attachment somehow share an identifier, the note wins.
  const files = [
    ...(await space.listPages()),
    ...(await space.listDocuments()),
  ];
  for (const file of files) {
    const identifier = parseDenoteName(file.name)?.identifier;
    // First one wins, so a duplicated identifier resolves deterministically.
    if (identifier && !map.has(identifier)) {
      map.set(identifier, file.name);
    }
  }
  identifierMap = map;
  identifierMapBuiltAt = Date.now();
  return map;
}

/** The page a Denote identifier refers to, if any note carries it. */
export async function resolveDenoteIdentifier(
  identifier: string,
): Promise<string | undefined> {
  return (await denoteIdentifierMap()).get(identifier);
}

const denoteTargetRegex = /^denote:([^:\s]+)(?:::(.*))?$/;

export async function indexDenote(
  pageMeta: PageMeta,
  _frontmatter: FrontMatter,
  tree: ParseTree,
  text: string,
): Promise<ObjectValue<any>[]> {
  const metadata = denoteMetadata(pageMeta.name, text);
  if (!metadata) {
    return [];
  }

  const objects: ObjectValue<any>[] = [
    {
      tag: "denote",
      ref: metadata.identifier,
      identifier: metadata.identifier,
      title: metadata.title,
      keywords: metadata.keywords,
      ...(metadata.signature ? { signature: metadata.signature } : {}),
      ...(metadata.date ? { date: metadata.date } : {}),
      page: pageMeta.name,
      extension: metadata.extension,
      pageLastModified: pageMeta.lastModified,
    } satisfies DenoteObject,
  ];

  const links = collectNodesOfType(tree, "DenoteLink");
  if (links.length === 0) {
    return objects;
  }
  const lineIndex = buildLineIndex(text);
  for (const link of links) {
    const targetNode = link.children?.find(
      (n) => n.type === "DenoteLinkTarget",
    );
    const target = targetNode ? renderToText(targetNode ?? undefined) : "";
    const match = denoteTargetRegex.exec(target);
    if (!match) {
      continue;
    }
    const identifier = match[1];
    const toPage = await resolveDenoteIdentifier(identifier);
    const descriptionNode = link.children?.find(
      (n) => n.type === "OrgLinkDescription",
    );
    const relation: RelationObject = {
      ref: `${pageMeta.name}@${link.from}`,
      tag: "relation",
      kind: "denote-link",
      from: pageMeta.name,
      fromTag: "page",
      // An unresolved identifier is kept as the target so a dangling link is
      // visible in the index rather than silently dropped.
      to: toPage ?? identifier,
      toTag: toPage ? "page" : "denote-identifier",
      page: pageMeta.name,
      range: [link.from!, link.to!],
      ...(pageMeta.name.endsWith(".org")
        ? orgLinkContext(lineIndex, link.from!)
        : { snippet: extractSnippet(pageMeta.name, lineIndex, link.from!) }),
      pageLastModified: pageMeta.lastModified,
    };
    if (descriptionNode) {
      relation.alias = renderToText(descriptionNode ?? undefined);
    }
    objects.push(relation);
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Creating notes
// ---------------------------------------------------------------------------

/**
 * Splits a keyword prompt's answer the way Denote's own does.
 *
 * Denote prompts with `completing-read-multiple`, whose separator is a comma —
 * *not* whitespace. That is what makes a multi-word keyword possible, and it
 * is the reason keyword sluggification joins words instead of hyphenating
 * them: `Genuine Issue Trial` is one keyword, `genuineissuetrial`. Keywords
 * are sorted, per `denote-sort-keywords`.
 */
export function parseKeywordInput(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((keyword) => sluggify("keyword", keyword))
        .filter(Boolean),
    ),
  ].sort();
}

/**
 * An identifier for `date` that no note in the space is using yet.
 *
 * Denote identifiers have one-second resolution, so two notes created in the
 * same second would collide — and an identifier is a note's identity, the
 * thing every inbound link resolves against, so a duplicate is not a cosmetic
 * problem. Denote bumps the second; so do we.
 */
export async function freeIdentifier(date: Date): Promise<string> {
  const taken = await denoteIdentifierMap();
  const candidate = new Date(date.getTime());
  for (let attempt = 0; attempt < 60; attempt++) {
    const identifier = denoteIdentifier(candidate);
    if (!taken.has(identifier)) {
      return identifier;
    }
    candidate.setSeconds(candidate.getSeconds() + 1);
  }
  throw new Error("Could not find a free Denote identifier");
}

/**
 * The Denote name an uploaded or pasted document should land under.
 *
 * Naming happens without a prompt: the identifier comes from the clock and the
 * title from the name the file arrived with, which is all `denote-rename-file`
 * would derive anyway for an attachment. Nothing is lost by not asking — the
 * name stays editable afterwards, and a note's own rename machinery updates
 * the links.
 *
 * @param options.name the file's incoming name; empty for a clipboard item
 * @param options.extension extension including the dot, for when `name` has none
 * @param options.time epoch milliseconds to date the identifier from, e.g. a
 *   file's modification time; defaults to now
 */
export async function denoteAttachmentPath(options: {
  name: string;
  extension?: string;
  time?: number;
}): Promise<string> {
  const date = options.time === undefined ? new Date() : new Date(options.time);
  const identifier = await freeIdentifier(date);
  return denoteAttachmentName(identifier, options.name, options.extension);
}

export type NewNoteSpec = {
  title: string;
  keywords: string[];
  signature?: string;
  fileType?: DenoteFileType;
  /**
   * A subdirectory to write into, as `denote-journal-directory` is one.
   * Denote's library is otherwise flat: keywords are the organisation.
   */
  directory?: string;
  /**
   * The moment the note is *for*, which the identifier is minted from: a
   * journal entry for a past day carries that day, as `denote-journal`'s
   * date prompt gives it, so the day's entry can be found again by its
   * identifier. Defaults to now.
   */
  date?: Date;
  /**
   * What the note starts with below its front matter: a `denote-templates`
   * entry, or the region `denote-region` was called on. A new note has an
   * empty body without one.
   */
  body?: string;
};

/**
 * Creates a Denote note and returns its page name.
 *
 * The note lands in the space root, which is what `denote-directory` means —
 * Denote keeps a flat library and relies on keywords, not folders.
 */
export async function createDenoteNote(spec: NewNoteSpec): Promise<string> {
  const fileType =
    spec.fileType ??
    ((await system.getConfig("denote.fileType", "org")) as DenoteFileType);
  const now = spec.date ?? new Date();
  const identifier = await freeIdentifier(now);
  // The signature is sluggified once and used for both the file name and the
  // front matter, so the two agree — as they do in real Denote notes. Only the
  // title differs between them: the front matter keeps the un-sluggified one,
  // because that is the only place it survives.
  const signature = spec.signature
    ? sluggify("signature", spec.signature)
    : undefined;
  const name = formatDenoteName({
    identifier,
    title: spec.title,
    keywords: spec.keywords,
    signature,
    extension: denoteExtension(fileType),
  });
  const pageName = denotePageName(
    spec.directory ? `${spec.directory}/${name}` : name,
  );
  const frontMatter = formatDenoteFrontMatter(
    {
      title: spec.title,
      date: denoteDate(now, fileType),
      keywords: spec.keywords,
      hasKeywords: spec.keywords.length > 0,
      identifier,
      signature,
    },
    fileType,
  );
  // Every front matter spec ends in a blank line, so a body follows directly.
  await space.writePage(
    pageName,
    spec.body ? `${frontMatter}${spec.body}` : frontMatter,
  );
  // The new note has to be resolvable by the links that will point at it.
  invalidateDenoteIdentifiers();
  return pageName;
}

/** Every keyword in the library, with how many notes carry it. */
export async function denoteKeywordCounts(): Promise<[string, number][]> {
  const notes = await index.queryLuaObjects<DenoteObject>("denote", {});
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const keyword of note.keywords ?? []) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  // Most-used first, then alphabetically: in a library with hundreds of
  // keywords the common ones are what you almost always want, and the filter
  // box searches the rest.
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const doneOption = "\u2713  Done";
const newKeywordOption = "\uFF0B  New keyword\u2026";
/**
 * Marks a keyword the note already carries. Keywords are sluggified, so one
 * can never contain this prefix itself and be mistaken for a row of its own.
 */
const removePrefix = "\u2715  ";

/**
 * Denote's keyword prompt with completion over the library's existing
 * keywords.
 *
 * Denote uses `completing-read-multiple`, which both completes what is already
 * in use and accepts something new. A filter box only picks from its list, so
 * new keywords get their own row rather than being unreachable — keeping a
 * library's keyword vocabulary consistent is most of the point of completing
 * them at all.
 *
 * `initial` is the set the prompt opens with, which is what lets one command
 * both add and remove: `denote-rename-file-keywords` prepopulates the
 * minibuffer with the note's own keywords and rewrites whatever is left
 * behind, so dropping one is editing the list rather than a second command.
 * Those rows are offered back marked with a cross, and picking one takes it
 * off.
 *
 * @returns the chosen keywords — on Escape, whatever is selected so far,
 *          which for a prefilled prompt leaves the note as it was
 */
export async function promptForKeywords(
  initial: string[] = [],
): Promise<string[] | undefined> {
  const counts = await denoteKeywordCounts();
  const selected: string[] = [...new Set(initial)];
  for (;;) {
    const options: FilterOption[] = [
      {
        name: doneOption,
        description: selected.length
          ? selected.join(", ")
          : "no keywords on this note",
        orderId: -2,
      },
      {
        name: newKeywordOption,
        description: "several at once, comma separated",
        orderId: -1,
      },
      // Already on the note, so the useful thing to offer is taking it off.
      ...selected.map((keyword) => ({
        name: `${removePrefix}${keyword}`,
        description: "on this note — remove",
        orderId: 0,
      })),
      ...counts
        .filter(([keyword]) => !selected.includes(keyword))
        .map(([keyword, count]) => ({
          name: keyword,
          description: `${count} note${count === 1 ? "" : "s"}`,
        })),
    ];
    const choice = await editor.filterBox(
      "Keyword",
      options,
      // Names the Done row as well as Escape: the row is the discoverable
      // way out, and Escape is the one a Denote user already knows.
      selected.length
        ? `Selected: ${selected.join(", ")} — pick another, or take Done (Escape also finishes)`
        : "Pick a keyword, or type a new one; Done or Escape when finished",
      "",
      // Denote's own prompt is `completing-read-multiple`, which completes
      // what the library already uses and takes anything else you type. A
      // keyword you have not used before is the ordinary case for a new note,
      // not an error.
      true,
      "new keyword",
    );
    // Escape means "that is all", as an empty answer does in Denote.
    if (!choice || choice.name === doneOption) {
      return selected.sort();
    }
    if (choice.name === newKeywordOption) {
      const typed = await editor.prompt("New keyword(s), comma separated:", "");
      if (typed !== undefined) {
        for (const keyword of parseKeywordInput(typed)) {
          if (!selected.includes(keyword)) {
            selected.push(keyword);
          }
        }
      }
      continue;
    }
    if (choice.name.startsWith(removePrefix)) {
      const dropped = choice.name.slice(removePrefix.length);
      const at = selected.indexOf(dropped);
      if (at !== -1) selected.splice(at, 1);
      continue;
    }
    // The filter box returns what was typed when nothing matched, so a
    // keyword still needs sluggifying here -- the rows above are already
    // slugs, and re-slugging one is a no-op.
    const typed = sluggify("keyword", choice.name.trim());
    if (typed && !selected.includes(typed)) selected.push(typed);
  }
}

/** A note the prompts below just made, in the shape a link to it needs. */
export type CreatedNote = {
  name: string;
  identifier: string;
  title: string;
  signature?: string;
  /**
   * Where the cursor belongs, counted back from the end of the file. A
   * template's `|^|` is the only thing that moves it off the end.
   */
  tailOffset: number;
};

// ---------------------------------------------------------------------------
// `denote-prompts`: the questions creating a note asks
// ---------------------------------------------------------------------------

/**
 * The prompts `denote.prompts` can ask for, by the names `denote-prompts`
 * uses for them.
 *
 * Denote's creation commands are not seven implementations of the same thing.
 * `denote` runs `denote-prompts`, which defaults to `(title keywords)`, and
 * every variant is that list with *one prompt appended*: `denote-signature`
 * appends `signature`, `denote-subdirectory` appends `subdirectory`,
 * `denote-type` appends `file-type`, and so on. That is the whole design, so
 * it is the design here -- one pipeline, and a command says only which prompt
 * it exists for.
 */
export const denotePromptNames = [
  "title",
  "keywords",
  "signature",
  "date",
  "file-type",
  "subdirectory",
  "template",
] as const;

export type DenotePromptName = (typeof denotePromptNames)[number];

/** `denote-prompts`' own default. */
const defaultPromptNames: DenotePromptName[] = ["title", "keywords"];

/**
 * `denote.prompts`, with anything unrecognised separated out for reporting.
 *
 * A typo should not stop you making a note, so an unknown name is dropped
 * rather than thrown -- but dropped silently it would make untitled notes out
 * of a misspelled `title` and leave you guessing, which is why the caller says
 * so. Missing or not a list means Denote's default, not no prompts at all: an
 * empty `denote.prompts` is a thing someone might mean, a missing one is not.
 */
export function readPromptNames(configured: unknown): {
  prompts: DenotePromptName[];
  unknown: string[];
} {
  if (!Array.isArray(configured)) {
    return { prompts: [...defaultPromptNames], unknown: [] };
  }
  const prompts: DenotePromptName[] = [];
  const unknown: string[] = [];
  for (const entry of configured) {
    const name = String(entry).trim();
    if (!name) {
      continue;
    }
    if (!(denotePromptNames as readonly string[]).includes(name)) {
      unknown.push(name);
      continue;
    }
    // Asking the same question twice has no useful reading, so the first
    // mention is where it is asked.
    if (!prompts.includes(name as DenotePromptName)) {
      prompts.push(name as DenotePromptName);
    }
  }
  return { prompts, unknown };
}

/**
 * The prompts a command runs: the configured list, plus the one that command
 * exists for.
 *
 * Appended, as Denote appends -- `denote-signature` asks for the signature
 * last, after the questions you always answer. Already in the list, it stays
 * where the configuration put it: someone who put `signature` first meant it.
 */
export function promptsWith(
  prompts: DenotePromptName[],
  extra?: DenotePromptName,
): DenotePromptName[] {
  if (!extra || prompts.includes(extra)) {
    return prompts;
  }
  return [...prompts, extra];
}

/** What the prompts fill in between them. */
export type NoteDraft = NewNoteSpec & { tailOffset: number };

/** A prompt fills in part of the draft, or answers false to abandon the note. */
type NotePrompt = (draft: NoteDraft) => Promise<boolean>;

/** The placeholder page templates already use to say where the cursor goes. */
const cursorMarker = "|^|";

const rootDirectoryOption = "\uFF0F  The library root";
const newDirectoryOption = "\uFF0B  New subdirectory\u2026";

/**
 * `denote-file-type`, described by what each one actually writes.
 *
 * Denote's fourth type, `text`, is missing: it writes `.txt`, which here is a
 * document rather than a page -- not indexed, not openable as a note, and so
 * not something to offer. A library that already contains `.txt` notes still
 * *parses* as one; this is only about what can be created.
 */
const fileTypeOptions: { type: DenoteFileType; label: string }[] = [
  { type: "org", label: "Org" },
  { type: "markdown-yaml", label: "Markdown, YAML front matter" },
  { type: "markdown-toml", label: "Markdown, TOML front matter" },
];

/**
 * The directories the library already uses, shallowest first.
 *
 * Read from the notes rather than from the file list, because
 * `denote-subdirectory-prompt` completes over subdirectories of
 * `denote-directory` and nothing else. The file list would additionally offer
 * every folder of the shipped `Library/Std` documentation -- dozens of rows,
 * none of them anywhere a note belongs, and read-only besides.
 */
async function denoteDirectories(): Promise<string[]> {
  const notes = await index.queryLuaObjects<DenoteObject>("denote", {});
  const directories = new Set<string>();
  for (const note of notes) {
    const parts = note.page.split("/");
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join("/"));
    }
  }
  return [...directories].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
}

/** A page name as a Lua string literal, for the template expression below. */
function luaString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const notePrompts: Record<DenotePromptName, NotePrompt> = {
  title: async (draft) => {
    const answer = await editor.prompt("Title:", draft.title);
    if (answer === undefined) {
      return false;
    }
    if (!answer.trim()) {
      await editor.flashNotification("A note needs a title", "error");
      return false;
    }
    draft.title = answer.trim();
    return true;
  },

  keywords: async (draft) => {
    const chosen = await promptForKeywords(draft.keywords);
    if (chosen === undefined) {
      return false;
    }
    draft.keywords = chosen;
    return true;
  },

  signature: async (draft) => {
    const answer = await editor.prompt("Signature:", draft.signature ?? "");
    if (answer === undefined) {
      return false;
    }
    draft.signature = answer.trim() || undefined;
    return true;
  },

  date: async (draft) => {
    const from = draft.date ?? new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const answer = await editor.prompt(
      "Date (YYYY-MM-DD, optionally HH:MM):",
      `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
    );
    if (answer === undefined) {
      return false;
    }
    const parsed = parseLocalDate(answer.trim());
    if (Number.isNaN(parsed.getTime())) {
      await editor.flashNotification(`Not a date: ${answer}`, "error");
      return false;
    }
    // The identifier is minted from this, so a note dated into the past sorts
    // and is found by its own day -- the point of `denote-date`.
    draft.date = parsed;
    return true;
  },

  "file-type": async (draft) => {
    const choice = await editor.filterBox(
      "File type",
      fileTypeOptions.map(({ type, label }) => ({
        name: label,
        description: denoteExtension(type),
        fileType: type,
      })),
      "The format the new note is written in",
    );
    if (!choice) {
      return false;
    }
    const picked = (choice as { fileType?: DenoteFileType }).fileType;
    if (!picked) {
      // Typed rather than picked, and matching nothing. The formats are a
      // fixed set, so a name that is not one of them is not an answer.
      await editor.flashNotification(
        `No such file type: ${choice.name}`,
        "error",
      );
      return false;
    }
    draft.fileType = picked;
    return true;
  },

  subdirectory: async (draft) => {
    const choice = await editor.filterBox(
      "Subdirectory",
      [
        {
          name: rootDirectoryOption,
          description: "the flat library, where notes normally go",
        },
        { name: newDirectoryOption },
        ...(await denoteDirectories()).map((directory) => ({
          name: directory,
        })),
      ],
      "The directory the new note is written into",
    );
    if (!choice) {
      return false;
    }
    if (choice.name === rootDirectoryOption) {
      draft.directory = undefined;
      return true;
    }
    let typed = choice.name;
    if (choice.name === newDirectoryOption) {
      const answer = await editor.prompt("New subdirectory:", "");
      if (answer === undefined) {
        return false;
      }
      typed = answer;
    }
    // A directory that does not exist yet is a fine answer either way --
    // writing the note creates it -- so a name typed past the end of the list
    // is taken as meant, the same as one picked off it.
    draft.directory = typed.trim().replace(/^\/+|\/+$/g, "") || undefined;
    return true;
  },

  template: async (draft) => {
    // `Note: New from Region` has already put the selection in the
    // body, and a template would overwrite it -- losing the text the command
    // exists to keep. The selection wins, and says so, because this only
    // happens to someone who has put `template` in `denote.prompts` and is
    // owed an explanation for not being asked.
    if (draft.body !== undefined) {
      await editor.flashNotification(
        "Keeping the selected text; no template applied",
      );
      return true;
    }
    // `denote-templates` is an alist in the user's init file; here the
    // equivalent already exists as pages tagged `meta/template/page`, which
    // is what every other template command in this fork reads.
    const templates = await index.queryLuaObjects<PageMeta>(
      "meta/template/page",
      {},
    );
    if (templates.length === 0) {
      await editor.flashNotification(
        "No page is tagged meta/template/page",
        "error",
      );
      return false;
    }
    const choice = await editor.filterBox(
      "Template",
      templates.map((template) => ({
        name: template.name.split("/").pop() ?? template.name,
        description:
          (template as { description?: string }).description ?? template.name,
        page: template.name,
      })),
      "The text the new note starts with",
    );
    const page = choice && (choice as { page?: string }).page;
    if (!page) {
      return false;
    }
    // Rendered through the same code every other template goes through, so a
    // `${...}` expression behaves identically here. That is why this asks Lua
    // instead of reading the page and stripping its front matter itself.
    const body = String(
      (await lua.evalExpression(`(template.fromPage(${luaString(page)}))()`)) ??
        "",
    );
    const at = body.indexOf(cursorMarker);
    if (at === -1) {
      draft.body = body;
      draft.tailOffset = 0;
      return true;
    }
    draft.body = body.slice(0, at) + body.slice(at + cursorMarker.length);
    draft.tailOffset = draft.body.length - at;
    return true;
  },
};

/**
 * Makes a note by asking what `denote.prompts` says to ask, plus the one
 * prompt the calling command exists for.
 *
 * `options.defaultTitle` is what `denote-open-or-create` and
 * `denote-link-or-create` pass along — both use whatever was typed at the file
 * prompt as the default value of the title prompt, rather than making you type
 * it twice. `options.body` is `denote-region`'s selection.
 *
 * Returns undefined when any prompt is cancelled, which abandons the whole
 * note: an empty answer to Denote's title prompt is not a note.
 */
export async function promptForNewNote(
  options: {
    extra?: DenotePromptName;
    defaultTitle?: string;
    body?: string;
    /**
     * What the caller already knows about the note, which `answered` then
     * keeps unasked.
     */
    seed?: Partial<Pick<NoteDraft, "keywords" | "date" | "fileType">>;
    /**
     * Prompts not to ask, because the caller has the answer. `Note: Extract`
     * reads the title, the keywords and the date off the heading it is
     * extracting, and Denote asks for each of those only when the heading has
     * nothing to say about it.
     */
    answered?: DenotePromptName[];
  } = {},
): Promise<CreatedNote | undefined> {
  const { prompts, unknown } = readPromptNames(
    await system.getConfig("denote.prompts", undefined),
  );
  if (unknown.length > 0) {
    await editor.flashNotification(
      `denote.prompts: no such prompt: ${unknown.join(", ")}`,
      "error",
    );
  }
  const draft: NoteDraft = {
    title: options.defaultTitle ?? "",
    keywords: options.seed?.keywords ?? [],
    date: options.seed?.date,
    fileType: options.seed?.fileType,
    body: options.body,
    tailOffset: 0,
  };
  const answered = new Set(options.answered ?? []);
  for (const name of promptsWith(prompts, options.extra)) {
    if (answered.has(name)) {
      continue;
    }
    if (!(await notePrompts[name](draft))) {
      return;
    }
  }
  // Reachable only from a `denote.prompts` with no `title` in it. Denote will
  // make an untitled note; this will not, because a library here is read
  // through pickers and views that show titles, and a row with nothing in it
  // is not findable by the one thing it is indexed under.
  if (!draft.title.trim()) {
    await editor.flashNotification("A note needs a title", "error");
    return;
  }
  const title = draft.title.trim();
  const name = await createDenoteNote({
    title,
    keywords: draft.keywords,
    signature: draft.signature,
    fileType: draft.fileType,
    directory: draft.directory,
    date: draft.date,
    body: draft.body,
  });
  const parsed = parseDenoteName(name);
  return {
    name,
    // `createDenoteNote` just minted the name, so it always parses.
    identifier: parsed?.identifier ?? "",
    title,
    signature: parsed?.signature,
    tailOffset: draft.tailOffset,
  };
}

/**
 * Opens a newly created note with the cursor in the body, not the front
 * matter — or at a template's `|^|`, which is the only thing that puts it
 * anywhere but the end.
 */
export async function openNewNote(name: string, tailOffset = 0): Promise<void> {
  const text = await space.readPage(name);
  await editor.navigate({
    // A ref carries a *path*, which always has an extension, while a Markdown
    // page's name does not -- navigating to the bare name is rejected as an
    // invalid ref.
    path: pathFromPageName(name),
    details: { type: "position", pos: Math.max(0, text.length - tailOffset) },
  });
}

async function promptForNote(extra?: DenotePromptName): Promise<void> {
  const created = await promptForNewNote({ extra });
  if (created) {
    await openNewNote(created.name, created.tailOffset);
  }
}

// Each of these is `denote` with one prompt appended, which is exactly what
// the Emacs command named in its comment is.

export function newDenoteNoteCommand(): Promise<void> {
  return promptForNote();
}

/** `denote-signature`. */
export function newDenoteNoteWithSignatureCommand(): Promise<void> {
  return promptForNote("signature");
}

/** `denote-type`. */
export function newDenoteNoteOfTypeCommand(): Promise<void> {
  return promptForNote("file-type");
}

/** `denote-date`. */
export function newDenoteNoteWithDateCommand(): Promise<void> {
  return promptForNote("date");
}

/** `denote-subdirectory`. */
export function newDenoteNoteInSubdirectoryCommand(): Promise<void> {
  return promptForNote("subdirectory");
}

/** `denote-template`. */
export function newDenoteNoteFromTemplateCommand(): Promise<void> {
  return promptForNote("template");
}

/**
 * `denote-region`: the selected text becomes the body of a new note.
 *
 * The selection is left where it is, as Denote leaves it — this lifts a
 * passage into a note of its own, it does not cut it out. Linking the two is
 * a separate decision, and `Note: Insert or Edit Link` already makes a note
 * out of a selection *and* links to it, which is the other thing you might
 * have wanted.
 */
export async function newDenoteNoteFromRegionCommand(): Promise<void> {
  const selection = await editor.getSelection();
  const body = (await editor.getText()).slice(selection.from, selection.to);
  if (!body.trim()) {
    await editor.flashNotification(
      "Select the text to make a note from",
      "error",
    );
    return;
  }
  // No default title: Denote asks for one outright here, and the first line
  // of a passage is a sentence, which makes a poor file name.
  const created = await promptForNewNote({
    body: body.endsWith("\n") ? body : `${body}\n`,
  });
  if (created) {
    await openNewNote(created.name, created.tailOffset);
  }
}

// ---------------------------------------------------------------------------
// Open or create, link or create
// ---------------------------------------------------------------------------

/**
 * Whether a phrase names a file rather than titling a note.
 *
 * Denote keeps a flat library and derives the file name from the title, so a
 * phrase carrying a path or a note extension was meant literally and is passed
 * through untouched.
 */
function namesAFile(phrase: string): boolean {
  return phrase.includes("/") || /\.(md|org|txt)$/i.test(phrase);
}

/**
 * Whether creating `phrase` from `currentPage` should mint a Denote note.
 *
 * Denote's commands only ever make Denote notes, because in Emacs you are
 * inside `denote-directory`. The nearest thing to being inside it here is the
 * note you are reading: creating from a Denote note stays in the library,
 * creating from an ordinary page does not. That keeps a mixed space working
 * and leaves a stock Markdown space alone.
 */
export function createsDenoteNote(
  phrase: string,
  currentPage: string,
): boolean {
  const title = phrase.trim();
  if (!title || namesAFile(title)) {
    return false;
  }
  return !!parseDenoteName(currentPage)?.identifier;
}

/**
 * `denote-open-or-create`, which is what the page picker's create row does.
 *
 * Denote uses the text typed at the file prompt as the *title* of the note it
 * then creates, so that is what the phrase means here too. In a Denote library
 * the alternative is silently wrong: navigating to the phrase would mint
 * `Some New Note.md`, a file with no identifier, outside the naming scheme and
 * unreachable by every `denote:` link.
 */
export async function denoteOpenOrCreate(phrase: string): Promise<void> {
  const currentPage = await editor.getCurrentPage();
  if (!createsDenoteNote(phrase, currentPage)) {
    await editor.navigate(phrase);
    return;
  }
  const created = await promptForNewNote({ defaultTitle: phrase.trim() });
  if (created) {
    await openNewNote(created.name, created.tailOffset);
  }
}

/**
 * The `[[` completion's create row: mints the note and writes the link to it.
 *
 * This is `denote-link-or-create` reached the way a writer actually reaches it
 * -- mid-sentence, with the title already typed. The client has cleared what
 * was typed and left the cursor between the brackets, so what goes in is the
 * *inner* link text, the same as every other page completion inserts.
 */
export async function denoteCreateFromLink(option: {
  title?: string;
}): Promise<void> {
  const title = (option.title ?? "").trim();
  if (!title) {
    return;
  }
  const created = await promptForNewNote({ defaultTitle: title });
  if (!created) {
    // Cancelled: put back what was typed, so nothing is silently lost.
    await editor.insertAtCursor(title);
    return;
  }
  const currentPage = await editor.getCurrentPage();
  await editor.insertAtCursor(
    innerPageLink(
      linkSyntaxFor(currentPage),
      created.name,
      denoteLinkDescription(created),
    ),
  );
}

const createNoteOption = "\uFF0B  Create note\u2026";

const linkToUrlOption = "\uD83D\uDD17  Link to URL\u2026";
const citeOption = "\uD83D\uDCDA  Cite a Zotero item\u2026";

/** Org's two link node types: `[[denote:ID][…]]` and everything else. */
const orgLinkTypes = ["DenoteLink", "OrgLink"];

/**
 * The Org link the cursor sits in, if any.
 *
 * Only Org links are found. On a Markdown page the command still inserts, it
 * just has nothing to edit -- this fork's link editing is Org's.
 */
export function linkAtPos(tree: ParseTree, pos: number): ParseTree | undefined {
  addParentPointers(tree);
  const node = nodeAtPos(tree, pos);
  if (!node) {
    return undefined;
  }
  if (orgLinkTypes.includes(node.type!)) {
    return node;
  }
  return (
    findParentMatching(node, (n) => orgLinkTypes.includes(n.type!)) ?? undefined
  );
}

/**
 * `org-insert-link` on an existing link: its target and description, both
 * offered as they stand. Emptying the target unlinks, leaving the words.
 */
async function editLink(link: ParseTree, syntax: LinkSyntax): Promise<void> {
  const targetNode =
    findNodeOfType(
      link,
      link.type === "DenoteLink" ? "DenoteLinkTarget" : "OrgLinkTarget",
    ) ?? undefined;
  const descriptionNode =
    findNodeOfType(link, "OrgLinkDescription") ?? undefined;
  const target = await editor.prompt("Link:", renderToText(targetNode));
  if (target === undefined) {
    return;
  }
  const description = await editor.prompt(
    "Description:",
    renderToText(descriptionNode),
  );
  if (description === undefined) {
    return;
  }
  await editor.replaceRange(
    link.from!,
    link.to!,
    target.trim()
      ? linkFor(syntax, target.trim(), description.trim())
      : // No target left: the link becomes the words it was showing.
        description.trim(),
  );
}

/**
 * `denote-link-or-create` and `org-insert-link` under one key.
 *
 * Which of the two you want is never ambiguous: on a link there is a link to
 * edit, and off one there is a link to make. Emacs splits them across `M-i`
 * and `M-I` only because it has no cheap way to ask.
 *
 * Making one: `[[` completion can only offer notes that already exist, and
 * with Denote it could not do otherwise — a link addresses a note by
 * identifier, and an identifier only exists once the file does. So the note is
 * created first and the link written to it afterwards. Denote creates it
 * `:in-background`, staying in the note you are writing, and so does this.
 *
 * A selection becomes the link's description, as an active region does for
 * `org-insert-link`; a selected URL is taken as the target instead.
 */
export async function denoteLinkOrCreateCommand(): Promise<void> {
  const [current, path, text, cursor, selection] = await Promise.all([
    editor.getCurrentPage(),
    editor.getCurrentPath(),
    editor.getText(),
    editor.getCursor(),
    editor.getSelection(),
  ]);
  const syntax = linkSyntaxFor(current);

  const link = linkAtPos(await markdown.parsePage(path, text), cursor);
  if (link) {
    return editLink(link, syntax);
  }

  // Where the link lands: over the selection when there is one, at the cursor
  // otherwise.
  const selected = selection.text ?? "";
  const from = selected ? selection.from : cursor;
  const to = selected ? selection.to : cursor;

  // A selected URL is a target, not a description -- selecting one and asking
  // for a link plainly means "make this a link".
  if (selected && hasLinkScheme(selected.trim())) {
    return insertUrlLink(syntax, from, to, selected.trim(), "");
  }

  const notes = await denoteNotes();
  const choice = await editor.filterBox(
    "Link",
    [
      {
        name: createNoteOption,
        description: "a note that does not exist yet",
        orderId: -1,
      },
      {
        name: linkToUrlOption,
        description: "somewhere outside this space",
        orderId: -1,
      },
      {
        name: citeOption,
        description: "from the bibliography",
        orderId: -1,
      },
      // A note never links to itself.
      ...notes
        .filter((note) => note.name !== current)
        .map((note) => ({
          name: denoteLinkDescription(note),
          description: note.keywords.join(", "),
          identifier: note.identifier,
        })),
    ],
    "Select a note to link to, or create one",
  );
  if (!choice) {
    return;
  }

  if (choice.name === linkToUrlOption) {
    return insertUrlLink(syntax, from, to, "", selected);
  }
  if (choice.name === citeOption) {
    const entry = await pickEntry();
    if (entry) {
      await editor.replaceRange(from, to, `[cite:@${entry.citekey}]`);
    }
    return;
  }

  let identifier: string;
  let description: string;
  if (choice.name === createNoteOption) {
    const created = await promptForNewNote({
      defaultTitle: selected || undefined,
    });
    if (!created) {
      return;
    }
    identifier = created.identifier;
    description = denoteLinkDescription(created);
  } else {
    identifier = choice.identifier;
    description = choice.name;
  }
  await editor.replaceRange(
    from,
    to,
    // A selection is what the link should read as; the note's title is only
    // the fallback for a link made from nothing.
    urlLink(syntax, `denote:${identifier}`, selected || description),
  );
}

// ---------------------------------------------------------------------------
// Keeping the file name in step with the front matter
// ---------------------------------------------------------------------------

/**
 * The file name a note's own front matter says it should have, or null when
 * the name is already right (or there is nothing to go on).
 *
 * This is `denote-rename-file-using-front-matter`, and it runs the opposite
 * way round from indexing: reading a note, the *file name* is authoritative,
 * because that is what links resolve against. Renaming, the *front matter* is,
 * because that is what the author just edited. The identifier is never taken
 * from the front matter — it is the note's identity, and every inbound link
 * resolves against it.
 */
export function denoteNameFromFrontMatter(
  pageName: string,
  text: string,
): string | null {
  const name = parseDenoteName(pageName);
  if (!name?.identifier) {
    return null;
  }
  const frontMatter = parseDenoteFrontMatter(
    text,
    denoteFileType(name.extension, text),
  );
  if (frontMatter.title === undefined) {
    // No title to rebuild the name from; leave the file alone.
    return null;
  }
  // Denote's library is flat, but not everything in it is: a journal lives in
  // `denote-journal-directory`, and a silo is its own folder. The front matter
  // describes the *note*, never where it sits, so the folder is carried across
  // -- rebuilding from the front matter alone would quietly move the file to
  // the space root and break the rename into a relocation.
  const slash = pageName.lastIndexOf("/");
  const folder = slash === -1 ? "" : pageName.slice(0, slash + 1);
  const renamed =
    folder +
    formatDenoteName({
      identifier: name.identifier,
      title: frontMatter.title,
      // An absent keywords line means "unknown", not "none": keep what the file
      // name already carries rather than silently dropping it. Keywords taken
      // from the front matter are sorted, as `denote--rename-file` does; the
      // file name's existing ones are left as they are, so a note is never
      // renamed purely to reorder them.
      keywords: frontMatter.hasKeywords
        ? frontMatter.keywords
            .map((keyword) => sluggify("keyword", keyword))
            .filter(Boolean)
            .sort()
        : name.keywords,
      signature: frontMatter.signature ?? name.signature,
      extension: name.extension,
    });
  return renamed === pageName ? null : renamed;
}

/** Guards against the rename's own save re-entering this. */
let renaming = false;

/**
 * Renames `pageName` to match its front matter, if they disagree.
 * @returns the new page name, or undefined if nothing changed
 */
export async function renameFromFrontMatter(
  pageName: string,
): Promise<string | undefined> {
  if (renaming) {
    return undefined;
  }
  // A rename now settles the question; a scheduled one would only find the
  // old name gone.
  const pending = renameTimers.get(pageName);
  if (pending !== undefined) {
    clearTimeout(pending);
    renameTimers.delete(pageName);
  }
  let text: string;
  try {
    text = await space.readPage(pageName);
  } catch {
    // Gone: the save that preceded this already renamed it, which is the
    // common case when a command edits the front matter and then asks for the
    // rename as well. Nothing left to do, and not an error.
    return undefined;
  }
  const renamed = denoteNameFromFrontMatter(pageName, text);
  if (!renamed) {
    return undefined;
  }
  renaming = true;
  try {
    // The target already being there means this note is in two files, which
    // its identifier says it cannot be. Fold rather than fail: this text is
    // the one that was just saved, so it is the one to keep.
    if (await sameNoteAt(renamed, renamed)) {
      await space.writePage(renamed, text);
      if ((await openPage()) === pageName) {
        await editor.navigate(
          { path: pathFromPageName(renamed) as `${string}.${string}` },
          true,
        );
      }
      await space.deletePage(pageName);
    } else {
      await batchRenameFiles([
        [pathFromPageName(pageName), pathFromPageName(renamed)],
      ]);
      await reclaimLateSave(pageName, renamed, text);
    }
  } finally {
    renaming = false;
  }
  invalidateDenoteIdentifiers();
  return renamed;
}

/**
 * Whether `page` holds a note whose own front matter says it belongs at
 * `expected` — the test for "this is the same note, under another name".
 */
async function sameNoteAt(page: string, expected: string): Promise<boolean> {
  let text: string;
  try {
    text = await space.readPage(page);
  } catch {
    return false; // not there at all, which is the ordinary case
  }
  const parsed = parseDenoteName(page);
  if (!parsed?.identifier) {
    return false;
  }
  return (denoteNameFromFrontMatter(page, text) ?? page) === expected;
}

/**
 * Takes back a save that landed on the name the rename just moved away from.
 *
 * Renaming an open page writes the new file, deletes the old one and then
 * navigates the editor across — and the editor saves pending changes before
 * it leaves, under the name it still thinks it is on. Someone who keeps
 * typing through all that has their keystrokes written straight back to the
 * file that was just deleted, leaving the note in two files under one
 * identifier. It is the newer text, so it is carried over rather than thrown
 * away; only then is the old name let go.
 */
async function reclaimLateSave(
  oldName: string,
  newName: string,
  moved: string,
): Promise<void> {
  if (!(await sameNoteAt(oldName, newName))) {
    return;
  }
  const resurrected = await space.readPage(oldName);
  if (resurrected !== moved) {
    await space.writePage(newName, resurrected);
  }
  await space.deletePage(oldName);
  console.log(
    `[denote] a save landed on ${oldName} mid-rename; folded into ${newName}`,
  );
}

export async function renameFromFrontMatterCommand() {
  const pageName = await editor.getCurrentPage();
  const renamed = await renameFromFrontMatter(pageName);
  await editor.flashNotification(
    renamed
      ? `Renamed to ${renamed}`
      : "File name already matches front matter",
  );
}

/**
 * Keeps the file name in step as the front matter is edited.
 *
 * Denote links address notes by identifier, so a rename never invalidates one
 * — which is what makes doing this automatically reasonable rather than
 * reckless. Set `denote.renameOnSave` to false to make it manual.
 */
export async function renameFromFrontMatterOnSave(pageName: string) {
  if (!(await system.getConfig("denote.renameOnSave", true))) {
    return;
  }
  scheduleRename(pageName);
}

/**
 * How long the front matter must sit still before the file name follows it.
 *
 * Saves land while a title is still being typed — SilverBullet saves a second
 * or so after the last keystroke — and renaming on each one renames mid-word:
 * a title typed as "Acorn Med" and finished as "Acorn Medic" is two renames,
 * and the second starts while the first is still writing, deleting and
 * navigating. So the rename waits for the typing to stop.
 */
const renameQuietPeriod = 2500;

/** Pages whose rename is waiting on the typing to stop. */
const renameTimers = new Map<string, number>();

/** The page the editor is showing, or undefined outside one. */
async function openPage(): Promise<string | undefined> {
  try {
    return await editor.getCurrentPage();
  } catch {
    return undefined;
  }
}

function scheduleRename(pageName: string) {
  const pending = renameTimers.get(pageName);
  if (pending !== undefined) {
    clearTimeout(pending);
  }
  renameTimers.set(
    pageName,
    setTimeout(() => {
      renameTimers.delete(pageName);
      void renameWhenSettled(pageName);
    }, renameQuietPeriod) as unknown as number,
  );
}

async function renameWhenSettled(pageName: string) {
  try {
    // An open page with unsaved changes is still being written: its front
    // matter is whatever was typed a moment ago, not what the author means.
    // The save that follows schedules this again.
    if ((await openPage()) === pageName) {
      const [inEditor, onDisk] = await Promise.all([
        editor.getText(),
        space.readPage(pageName).catch(() => undefined),
      ]);
      if (onDisk === undefined || inEditor !== onDisk) {
        return;
      }
    }
    await renameFromFrontMatter(pageName);
  } catch (e: any) {
    console.warn("[denote] could not rename from front matter", e.message);
  }
}

// ---------------------------------------------------------------------------
// Dynamic blocks
// ---------------------------------------------------------------------------

export type DenoteNoteSummary = {
  name: string;
  identifier: string;
  title: string;
  signature?: string;
  keywords: string[];
};

/**
 * Every Denote note in the space, in file-name order — Denote's own order.
 *
 * Denote counts `.org`, `.md` *and* `.txt` as notes. Only the first two are
 * SilverBullet pages, so a `.txt` note never reaches the index; those are
 * picked up from the document list and read directly, because their front
 * matter holds the only properly-cased copy of their title.
 */
export async function denoteNotes(): Promise<DenoteNoteSummary[]> {
  const [indexed, documents] = await Promise.all([
    index.queryLuaObjects<DenoteObject>("denote", {}),
    space.listDocuments(),
  ]);
  const notes: DenoteNoteSummary[] = indexed.map((note) => ({
    name: note.page,
    identifier: note.identifier,
    title: note.title,
    signature: note.signature,
    keywords: note.keywords ?? [],
  }));
  const seen = new Set(notes.map((note) => note.identifier));

  const decoder = new TextDecoder();
  for (const document of documents) {
    const parsed = parseDenoteName(document.name);
    if (!parsed?.identifier || seen.has(parsed.identifier)) {
      continue;
    }
    let title = parsed.title ? unslugTitle(parsed.title) : parsed.identifier;
    // Only a *note* is opened to read its front matter. `denote-directory-files`
    // lists every file carrying an identifier, so a Denote-named PDF belongs in
    // this list and a dblock's `:regexp` should still match it — but it has no
    // front matter to find, and reading it means downloading it. A real
    // library holds a few hundred megabytes of such attachments against a few
    // of notes, and this runs on every journal command and every dynamic
    // block. Its file name is the only title it has anyway.
    if (isDenoteNoteFile(document.name)) {
      try {
        const text = decoder.decode(await space.readDocument(document.name));
        const frontMatter = parseDenoteFrontMatter(
          text,
          denoteFileType(parsed.extension, text),
        );
        if (frontMatter.title) {
          title = frontMatter.title;
        }
      } catch {
        // Unreadable: the file-name title is still better than dropping the note.
      }
    }
    notes.push({
      name: document.name,
      identifier: parsed.identifier,
      title,
      signature: parsed.signature,
      keywords: parsed.keywords,
    });
  }
  return notes.sort((a, b) => a.name.localeCompare(b.name));
}

const sortKey: Record<string, (n: DenoteNoteSummary) => string> = {
  title: (n) => n.title,
  keywords: (n) => n.keywords.join("_"),
  signature: (n) => n.signature ?? "",
  identifier: (n) => n.identifier,
};

/** Formats a note list as Org links, honouring :id-only and :include-date. */
function renderLinkList(
  notes: DenoteNoteSummary[],
  params: DblockParams,
): string {
  return notes
    .map((note) => {
      const description = params["id-only"]
        ? note.identifier
        : denoteLinkDescription(note);
      const dated = params["include-date"]
        ? `${description} (${denoteIdentifierDate(note.identifier)})`
        : description;
      return `- [[denote:${note.identifier}][${dated}]]`;
    })
    .join("\n");
}

/** Applies :sort-by-component and :reverse-sort. */
function applySorting(
  notes: DenoteNoteSummary[],
  params: DblockParams,
): DenoteNoteSummary[] {
  let sorted = notes;
  const component = params["sort-by-component"];
  if (typeof component === "string" && sortKey[component]) {
    const key = sortKey[component];
    sorted = [...sorted].sort((a, b) => key(a).localeCompare(key(b)));
  }
  return params["reverse-sort"] ? [...sorted].reverse() : sorted;
}

/** The notes a `:regexp`/`:not-regexp` pair selects, minus the current note. */
function selectByRegexp(
  params: DblockParams,
  notes: DenoteNoteSummary[],
  currentPage: string,
): DenoteNoteSummary[] {
  const pattern = params.regexp;
  const matches = compileDblockRegexp(
    typeof pattern === "string" ? pattern : "",
  );
  const excludes =
    typeof params["not-regexp"] === "string"
      ? compileDblockRegexp(params["not-regexp"])
      : undefined;
  return notes.filter(
    // Denote passes :omit-current, so a block never links to its own note.
    (note) =>
      note.name !== currentPage && matches(note.name) && !excludes?.(note.name),
  );
}

/**
 * `denote-backlinks`: the notes that link *to* this one.
 *
 * `:this-heading-only` is not supported — a link is indexed against its page,
 * not the heading it sits under — so such a block is left alone rather than
 * silently answered with the whole page's backlinks.
 */
export function renderDenoteBacklinksBlock(
  params: DblockParams,
  notes: DenoteNoteSummary[],
  backlinkPages: Set<string>,
): string | null {
  if (params["this-heading-only"]) {
    return null;
  }
  const excludes =
    typeof params["not-regexp"] === "string"
      ? compileDblockRegexp(params["not-regexp"])
      : undefined;
  return renderLinkList(
    applySorting(
      notes.filter(
        (note) => backlinkPages.has(note.name) && !excludes?.(note.name),
      ),
      params,
    ),
    params,
  );
}

/** `denote-missing-links`: notes matching the regexp this page does *not* link to. */
export function renderDenoteMissingLinksBlock(
  params: DblockParams,
  notes: DenoteNoteSummary[],
  currentPage: string,
  linkedIdentifiers: Set<string>,
): string {
  return renderLinkList(
    applySorting(
      selectByRegexp(params, notes, currentPage).filter(
        (note) => !linkedIdentifiers.has(note.identifier),
      ),
      params,
    ),
    params,
  );
}

/**
 * The body of a `denote-links` dynamic block: one Org link per matching note.
 *
 * Denote matches `:regexp` against the *file name*, which is why a keyword
 * (`_costs`) or a signature (`==6`) works as a filter — they are literally
 * substrings of the name.
 */
export function renderDenoteLinksBlock(
  params: DblockParams,
  notes: DenoteNoteSummary[],
  currentPage: string,
): string {
  return renderLinkList(
    applySorting(selectByRegexp(params, notes, currentPage), params),
    params,
  );
}

/** A dynamic block found in a page's text. */
type DynamicBlock = {
  type: string;
  params: DblockParams;
  /** Range of the generated body, between the two delimiter lines. */
  bodyFrom: number;
  bodyTo: number;
};

export function findDynamicBlocks(tree: ParseTree): DynamicBlock[] {
  return collectNodesOfType(tree, "OrgDynamicBlock").flatMap((block) => {
    const children = block.children ?? [];
    const marks = children.filter((n) => n.type === "OrgDynamicBlockMark");
    const type = children.find((n) => n.type === "OrgDynamicBlockType");
    if (marks.length < 2 || !type) {
      return [];
    }
    const params = children.find((n) => n.type === "OrgDynamicBlockParams");
    return [
      {
        type: renderToText(type),
        params: params ? parseDblockParams(renderToText(params)) : {},
        // From just after the opening line to the start of `#+END:`.
        bodyFrom: marks[0].to! + (params ? 0 : 0),
        bodyTo: marks[marks.length - 1].from!,
      },
    ];
  });
}

/** Pages holding a `denote:` link to `pageName`. */
async function backlinkPagesFor(pageName: string): Promise<Set<string>> {
  const relations = await index.queryLuaObjects<any>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `_.kind == "denote-link" and _.to == target`,
      ),
    },
    { target: pageName },
  );
  return new Set(relations.map((relation) => relation.page));
}

/**
 * Who links to a page, and how many links each of them holds.
 *
 * For telling someone what a deletion would break: a `denote:` link finds a
 * note by its identifier, and an identifier belongs to one file, so removing
 * that file leaves every link to it pointing at nothing.
 */
export async function inboundLinksFor(
  page: string,
): Promise<{ page: string; title: string; count: number }[]> {
  const relations = await index.queryLuaObjects<any>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `_.to == target and _.kind != "co-mention"`,
      ),
    },
    { target: page },
  );
  const counts = new Map<string, number>();
  for (const relation of relations) {
    if (relation.page === page) continue; // a link to itself breaks nothing
    counts.set(relation.page, (counts.get(relation.page) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const titles = new Map<string, string>();
  for (const note of await index.queryLuaObjects<DenoteObject>("denote", {})) {
    if (note.page && note.title) titles.set(note.page, note.title);
  }
  return [...counts]
    .map(([from, count]) => ({
      page: from,
      title: titles.get(from) ?? from,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** Identifiers this page already links to. */
function linkedIdentifiers(tree: ParseTree): Set<string> {
  const identifiers = new Set<string>();
  for (const link of collectNodesOfType(tree, "DenoteLink")) {
    const target = link.children?.find((n) => n.type === "DenoteLinkTarget");
    const match = target && denoteTargetRegex.exec(renderToText(target));
    if (match) {
      identifiers.add(match[1]);
    }
  }
  return identifiers;
}

/** Guards against the rewrite's own save re-entering this. */
let updatingDblocks = false;

/**
 * Regenerates every `denote-links` block in the page open in the editor, as
 * `org-dblock-update` does. Other block types are left alone rather than
 * emptied.
 *
 * @returns how many blocks changed, or -1 if the page holds none
 */
export async function updateDynamicBlocks(): Promise<number> {
  if (updatingDblocks) {
    return 0;
  }
  const pageName = await editor.getCurrentPage();
  const text = await editor.getText();
  const tree = await markdown.parsePage(await editor.getCurrentPath(), text);
  const generated = new Set([
    "denote-links",
    "denote-backlinks",
    "denote-missing-links",
  ]);
  const blocks = findDynamicBlocks(tree).filter((block) =>
    generated.has(block.type.toLowerCase()),
  );
  if (blocks.length === 0) {
    return -1;
  }
  const notes = await denoteNotes();
  // Only fetched when a block actually needs them.
  let backlinks: Set<string> | undefined;
  let linked: Set<string> | undefined;
  let updated = text;
  let changed = 0;
  // Back to front, so each replacement leaves earlier offsets valid.
  for (const block of [...blocks].reverse()) {
    const type = block.type.toLowerCase();
    let body: string | null;
    if (type === "denote-backlinks") {
      backlinks ??= await backlinkPagesFor(pageName);
      body = renderDenoteBacklinksBlock(block.params, notes, backlinks);
    } else if (type === "denote-missing-links") {
      linked ??= linkedIdentifiers(tree);
      body = renderDenoteMissingLinksBlock(
        block.params,
        notes,
        pageName,
        linked,
      );
    } else {
      body = renderDenoteLinksBlock(block.params, notes, pageName);
    }
    // A block this cannot generate keeps whatever it already holds.
    if (body === null) {
      continue;
    }
    // The body sits between the opening line's newline and the `#+END:` line.
    const from = updated.indexOf("\n", block.bodyFrom) + 1;
    const replacement = body ? `${body}\n` : "";
    if (updated.slice(from, block.bodyTo) !== replacement) {
      changed++;
    }
    updated =
      updated.slice(0, from) + replacement + updated.slice(block.bodyTo);
  }
  if (updated === text) {
    return 0;
  }
  // Rendering took a moment; a keystroke in it would be lost to a whole-text
  // replacement. Leave the page alone then -- the save that follows the
  // typing brings the blocks up to date instead.
  if ((await editor.getText()) !== text) {
    return 0;
  }
  updatingDblocks = true;
  try {
    await editor.setText(updated);
  } finally {
    updatingDblocks = false;
  }
  return changed;
}

export async function updateDynamicBlocksCommand() {
  const changed = await updateDynamicBlocks();
  await editor.flashNotification(
    changed === -1
      ? "No denote-links blocks on this page"
      : changed > 0
        ? `Updated ${changed} dynamic block${changed === 1 ? "" : "s"}`
        : "Dynamic blocks already up to date",
  );
}

/**
 * Keeps dynamic blocks current as a note is edited.
 *
 * Only the page open in the editor is touched: a save arriving from sync or a
 * background write belongs to a buffer this does not own, and rewriting it
 * through the editor would land the text on the wrong page. The rewrite is a
 * no-op once nothing changes, so it settles after one pass.
 *
 * Set `denote.updateDblocksOnSave` to false to make it manual.
 */
export async function updateDynamicBlocksOnSave(pageName: string) {
  if (!(await system.getConfig("denote.updateDblocksOnSave", true))) {
    return;
  }
  try {
    if ((await editor.getCurrentPage()) !== pageName) {
      return;
    }
    await updateDynamicBlocks();
  } catch (e: any) {
    console.warn("[denote] could not update dynamic blocks", e.message);
  }
}

/**
 * Brings a note's dynamic blocks up to date as it is opened, so a hub page
 * reads true without a keystroke -- the notes it lists were written and
 * renamed while it sat closed. Only a writable page is touched, and only
 * when something changed, which then saves as any edit does.
 *
 * Set `denote.updateDblocksOnOpen` to false to make it manual.
 */
export async function updateDynamicBlocksOnOpen(pageName: string) {
  if (!(await system.getConfig("denote.updateDblocksOnOpen", true))) {
    return;
  }
  try {
    if ((await editor.getCurrentPage()) !== pageName) {
      return;
    }
    const meta = await editor.getCurrentPageMeta();
    if (meta?.perm === "ro") {
      return;
    }
    const changed = await updateDynamicBlocks();
    if (changed > 0) {
      await editor.save();
    }
  } catch (e: any) {
    console.warn("[denote] could not update dynamic blocks on open", e.message);
  }
}

/**
 * Inserts a dynamic block at the cursor and fills it in, as
 * `denote-org-dblock-insert-*` do. The parameter list mirrors what Denote
 * writes, so a block created here is one Emacs recognises.
 */
async function insertDblock(name: string, params: string) {
  const pos = await editor.getCursor();
  await editor.insertAtPos(`#+BEGIN: ${name} ${params}\n#+END:\n`, pos);
  await updateDynamicBlocks();
}

export async function insertLinksDblockCommand() {
  const regexp = await editor.prompt("Files matching regexp:", "");
  if (regexp === undefined) {
    return;
  }
  await insertDblock(
    "denote-links",
    `:regexp ${JSON.stringify(regexp)} :not-regexp nil :excluded-dirs-regexp nil ` +
      `:sort-by-component nil :reverse-sort nil :id-only nil :include-date nil`,
  );
}

export async function insertBacklinksDblockCommand() {
  await insertDblock(
    "denote-backlinks",
    `:excluded-dirs-regexp nil :sort-by-component nil :reverse-sort nil ` +
      `:id-only nil :this-heading-only nil :include-date nil`,
  );
}

export async function insertMissingLinksDblockCommand() {
  const regexp = await editor.prompt("Files matching regexp:", "");
  if (regexp === undefined) {
    return;
  }
  await insertDblock(
    "denote-missing-links",
    `:regexp ${JSON.stringify(regexp)} :not-regexp nil :excluded-dirs-regexp nil ` +
      `:sort-by-component nil :reverse-sort nil :id-only nil`,
  );
}

/**
 * A links block scoped to today, which is a common enough thing to want that
 * it is worth its own command rather than typing the date into a prompt.
 */
export async function insertTodaysLinksDblockCommand() {
  const today = denoteIdentifier(new Date()).slice(0, 8);
  await insertDblock(
    "denote-links",
    `:regexp ${JSON.stringify(today)} :not-regexp nil :excluded-dirs-regexp nil ` +
      `:sort-by-component nil :reverse-sort nil :id-only nil :include-date nil`,
  );
}

// ---------------------------------------------------------------------------
// denote-journal
// ---------------------------------------------------------------------------

type JournalConfig = {
  /** `denote-journal-directory`, relative to the space. */
  directory: string;
  /** `denote-journal-keyword`. */
  keyword: string;
  /** `denote-journal-title-format`. */
  titleFormat: string;
};

async function journalConfig(): Promise<JournalConfig> {
  return {
    directory: (await system.getConfig(
      "denote.journalDirectory",
      "journal",
    )) as string,
    keyword: (await system.getConfig(
      "denote.journalKeyword",
      "journal",
    )) as string,
    titleFormat: (await system.getConfig(
      "denote.journalTitleFormat",
      "day-date-month-year-24h",
    )) as string,
  };
}

/**
 * Whether a note is a journal entry for the day `stamp` names.
 *
 * This is `denote-journal--filename-regexp` and `--keyword-regex` together: an
 * entry lives in the journal directory, its identifier is stamped with that
 * day, and it carries the journal keyword. The identifier is what decides the
 * day — not the front matter date, which a user may have edited.
 */

/**
 * The journal entries for one day, newest first, found from file names.
 *
 * Deliberately not from the index. The index is a cache that lags: on a cold
 * start it is still being built, and just after a sync it does not yet know
 * about an entry another device wrote -- and in both cases a lookup that
 * misses does not degrade, it creates a second entry for the day and splits
 * the journal in two. A Denote name carries the date and the keyword, so the
 * file list answers this on its own, with nothing to catch up on first.
 */
async function journalEntryNamesOn(
  stamp: string,
  config: JournalConfig,
  authoritative = false,
): Promise<string[]> {
  const pages = authoritative
    ? await space.listPagesAuthoritative()
    : await space.listPages();
  return pages
    .map((page) => page.name)
    .filter((name) => {
      if (!isJournalEntryName(name, config)) {
        return false;
      }
      return !!parseDenoteName(name)?.identifier?.startsWith(stamp);
    })
    .sort((a, b) => b.localeCompare(a));
}

/** Every journal entry, newest first. */
export async function denoteJournalEntries(): Promise<DenoteNoteSummary[]> {
  const config = await journalConfig();
  const notes = await denoteNotes();
  return notes
    .filter(
      (note) =>
        (config.directory
          ? note.name.startsWith(`${config.directory}/`)
          : true) && note.keywords.includes(config.keyword),
    )
    .sort((a, b) => b.identifier.localeCompare(a.identifier));
}

/**
 * `denote-journal-new-or-existing-entry`: open today's entry, creating it if
 * there is none.
 *
 * Denote prompts when a day has more than one entry; the newest is taken here
 * instead, since the picker is a keystroke away and a prompt on a key you
 * press every day gets old.
 */
export async function denoteJournalOpenOrCreate(
  dateStr?: string,
): Promise<void> {
  const config = await journalConfig();
  const now = new Date();
  let when = dateStr ? parseLocalDate(dateStr) : now;
  if (Number.isNaN(when.getTime())) {
    await editor.flashNotification(`Not a date: ${dateStr}`, "error");
    return;
  }
  // A date string carries no time, but the default title format ends in
  // `%H:%M` -- denote-journal stamps an entry with the moment it was written.
  // For today that moment is now; for an explicit past date there is no such
  // moment, and midnight is the honest answer.
  if (journalDateStamp(when) === journalDateStamp(now)) {
    when = now;
  }
  const stamp = journalDateStamp(when);
  // The cached list first: finding an entry there is always right, and free.
  // It is *not* finding one that is dangerous. `space.listPages()` is read
  // through the service worker, which answers from a background-synced
  // replica -- so an entry written on another device, or minutes ago on this
  // one, can be missing from it. That is how a second entry for the day gets
  // written, and it is why moving this lookup from the index to the file
  // list did not fix it: both are caches.
  let existing = await journalEntryNamesOn(stamp, config);
  if (existing.length === 0) {
    // About to create: the one moment the answer has to be the server's.
    existing = await journalEntryNamesOn(stamp, config, true);
    if (existing.length > 0) {
      // Worth saying out loud. This bug is invisible until the duplicates
      // pile up, and the test harness cannot reproduce it -- the service
      // worker is off there -- so this line is the evidence that the check
      // is doing its job.
      console.log(
        "[denote] today's entry was missing from the cached file list; " +
          "the server had it. No second entry made.",
      );
    }
  }
  if (existing.length > 0) {
    await editor.navigate(pathFromPageName(existing[0]) as any);
    return;
  }
  const pageName = await createDenoteNote({
    title: journalTitle(when, config.titleFormat),
    keywords: [config.keyword],
    directory: config.directory,
    date: when,
  });
  const text = await space.readPage(pageName);
  await editor.navigate({
    // The page name of a Markdown note carries no extension; a ref's path
    // always does.
    path: pathFromPageName(pageName),
    details: { type: "position", pos: text.length },
  });
}

/**
 * The entry before or after the one being read, by identifier.
 *
 * Ordering on the identifier rather than the front-matter date keeps this
 * agreeing with which day an entry *is*, which is the same thing
 * `denote-journal` matches on.
 */
export async function denoteJournalNeighbor(
  direction: "previous" | "next",
): Promise<void> {
  const entries = await denoteJournalEntries();
  if (entries.length === 0) {
    await editor.flashNotification("No journal entries yet", "error");
    return;
  }
  const current = await editor.getCurrentPage();
  const index = entries.findIndex((note) => note.name === current);
  // Reading something that is not an entry, "previous" means the latest one.
  const target =
    index === -1
      ? direction === "previous"
        ? entries[0]
        : undefined
      : direction === "previous"
        ? entries[index + 1]
        : entries[index - 1];
  if (!target) {
    await editor.flashNotification(
      direction === "previous"
        ? "No earlier journal entries"
        : "No later journal entries",
      "error",
    );
    return;
  }
  await editor.navigate(pathFromPageName(target.name) as any);
}

export function denoteJournalTodayCommand(): Promise<void> {
  return denoteJournalOpenOrCreate();
}

export function denoteJournalPreviousCommand(): Promise<void> {
  return denoteJournalNeighbor("previous");
}

export function denoteJournalNextCommand(): Promise<void> {
  return denoteJournalNeighbor("next");
}

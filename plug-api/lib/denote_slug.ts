/**
 * PROVENANCE. This module is an independent ("clean room") implementation.
 *
 * Denote's file-naming scheme is a file format, and this fork has to produce
 * byte-identical names so that Emacs and this editor can edit one library.
 * The rules here were derived from **recorded behaviour** of the Emacs tool,
 * treated as a black box: 1,713 input/output pairs covering every printable
 * ASCII character in four positions for all four components, plus a 4,000-note
 * real library as an independent check. `denote.el` itself was not consulted
 * while this was written, and no part of it is reproduced here. The fixtures
 * and the generator that produced them are in `tools/denote-slug-oracle/`, and
 * `PROVENANCE.md` at the repository root records the process.
 *
 * Practical consequence: conformance is defined by
 * `plug-api/lib/denote_slug.test.ts`. Change behaviour only by re-probing the
 * reference tool and updating the fixture, never by reading its source.
 */

/**
 * Turns human-typed text into one component of a note's file name.
 *
 * A name looks like
 *
 *     20240322T131856==sig--some-title__topic1_topic2.org
 *
 * and is parsed by scanning for the doubled delimiters `==`, `--`, `__`, `@@`
 * and for the extension dot. So a component may not contain anything that
 * could be mistaken for one of those, and — because each component is joined
 * to the next by its own punctuation mark — each one has to clean up its text
 * slightly differently.
 *
 * Every rule below was derived from recorded input/output pairs of the tool
 * these names have to interoperate with; where a rule is surprising, the
 * comment says so rather than justifying it.
 */

export type DenoteComponent = "identifier" | "signature" | "title" | "keyword";

/**
 * What each text component puts *between* two words.
 *
 * `keyword` joins with nothing at all. Keywords are separated from one another
 * by `_` in the file name, so no separator may appear inside a single keyword
 * — not even a hyphen — and the words of a multi-word keyword are simply run
 * together.
 */
const WORD_JOINER: Record<"signature" | "title" | "keyword", string> = {
  title: "-",
  signature: "=",
  keyword: "",
};

/** The punctuation marks that join components to each other in a file name. */
const COMPONENT_DELIMITERS = ["-", "=", "@", "_"] as const;

/**
 * Punctuation thrown away outright by all three text components.
 *
 * This is a deny list, not an allow list, and it is narrower than it looks:
 * `<`, `>` and `\` are *kept* verbatim, as are all non-ASCII characters apart
 * from the typographic quotation marks below. Accented Latin, Greek, Cyrillic,
 * CJK, emoji, dashes of every width, the non-breaking space and the
 * zero-width space all survive untouched.
 */
const DISCARDED_PUNCTUATION = new Set([
  ...`!"#$%&'()*+,./:;?@[]^\`{|}~`,
  "‘", // ' left single quotation mark
  "’", // ' right single quotation mark
  "“", // " left double quotation mark
  "”", // " right double quotation mark
]);

/**
 * Punctuation thrown away by `identifier`, which is otherwise left alone.
 *
 * Far shorter than the list above: an identifier keeps nearly all ASCII
 * punctuation, including quotes, colons and slashes.
 */
const DISCARDED_FROM_IDENTIFIER = new Set([...".()[]"]);

/**
 * Markers that an identifier never carries, and that are cut out wherever they
 * appear. These are search prefixes from the surrounding tool rather than
 * anything a person would type into a name.
 */
const QUERY_MARKERS = ["query-filenames:", "query-contents:"];

/**
 * Does this character end a word, for a component that joins with `joiner`?
 *
 * Three things end a word, and no others:
 *
 *  - the plain space `U+0020`;
 *  - `_`, which breaks a word in every component (it is the keyword separator,
 *    so it can never survive inside one);
 *  - the component's own joining mark, so that text already written in the
 *    component's own style keeps its word breaks.
 *
 * Whitespace here means *the plain space and nothing else*, which is the
 * easiest rule here to get wrong: a tab, a no-break space `U+00A0`, a narrow
 * no-break space `U+202F`, a thin space `U+2009` and a zero-width space
 * `U+200B` are all ordinary kept characters, passed through untouched. So a
 * title made from `"a \t b"` is `"a-\t-b"` — the two plain spaces become
 * separators and the tab simply stays put between them — and one made from
 * `"x y z"` is `"x-y z"`, hyphenated at the space and not at the
 * no-break space beside it.
 */
function endsWord(ch: string, joiner: string): boolean {
  return ch === " " || ch === "_" || (joiner !== "" && ch === joiner);
}

/** Split text into its surviving words, dropping everything discarded. */
function wordsOf(text: string, joiner: string): string[] {
  const words: string[] = [];
  let word = "";

  const endWord = () => {
    if (word !== "") words.push(word);
    word = "";
  };

  for (const ch of text) {
    if (endsWord(ch, joiner)) endWord();
    else if (!DISCARDED_PUNCTUATION.has(ch)) word += ch;
  }
  endWord();

  return words;
}

/**
 * `title`, `signature` and `keyword`: lowercase, split into words, rejoin.
 *
 * Splitting and rejoining is what makes runs of separators collapse and
 * leading and trailing ones vanish, with no extra trimming pass.
 *
 * A delimiter that is not this component's own joining mark, and is not `_`,
 * is simply deleted — it is not a word break. So `=` and `@` disappear from a
 * title (`"a=b"` -> `"ab"`), while `-` and `@` disappear from a signature
 * (`"a-b"` -> `"ab"`); each component only recognises its own mark.
 */
function sluggifyWords(
  component: "signature" | "title" | "keyword",
  input: string,
): string {
  const joiner = WORD_JOINER[component];
  const foreignDelimiters = COMPONENT_DELIMITERS.filter(
    (d) => d !== joiner && d !== "_",
  );

  let text = input.toLowerCase();
  for (const d of foreignDelimiters) text = text.split(d).join("");

  return wordsOf(text, joiner).join(joiner);
}

/**
 * `identifier`: the odd one out.
 *
 * It is a machine-made timestamp rather than prose, so it is left far more
 * nearly alone than the other three: its case is kept, its spaces are kept
 * (even runs of them), and almost all punctuation is kept. Only three things
 * happen to it: the query markers and `.()[]` are cut out, a doubled delimiter
 * is squeezed back down to one so it cannot be read as a component boundary,
 * and trailing delimiters are trimmed. A *leading* delimiter survives, which
 * is the one place where the identifier contradicts the other components.
 */
function sluggifyIdentifier(input: string): string {
  let text = input;
  for (const marker of QUERY_MARKERS) text = text.split(marker).join("");

  text = [...text].filter((ch) => !DISCARDED_FROM_IDENTIFIER.has(ch)).join("");

  return text
    .replace(/([-=@_])\1+/g, "$1") // "a--b" -> "a-b"
    .replace(/[-=@_]+$/, ""); // "trail-" -> "trail"
}

/**
 * Clean `input` so that it is safe to use as the given component of a note's
 * file name. Total, pure and idempotent on its own output.
 */
export function sluggify(component: DenoteComponent, input: string): string {
  return component === "identifier"
    ? sluggifyIdentifier(input)
    : sluggifyWords(component, input);
}

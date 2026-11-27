import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { parseOrg } from "../../client/org_parser/parser.ts";
import {
  extractedFileType,
  headingDate,
  headingParts,
  parseOrgTimestamp,
  subtreeAt,
} from "./denote_extract.ts";

/** The subtree at `pos` in an Org page. */
function org(text: string, pos: number) {
  return subtreeAt(text, parseOrg(text), pos);
}

/** The subtree at `pos` in a Markdown page. */
function md(text: string, pos: number) {
  return subtreeAt(text, parseMarkdown(text), pos);
}

test("the subtree is the heading above the cursor, down to its next peer", () => {
  const page = `#+title: Source

* First
First body.

** Under first
Deeper body.

* Second
Second body.
`;
  // From inside the body of a subheading, the subtree is still the one the
  // cursor is in -- the nearest heading at or above it.
  const deep = org(page, page.indexOf("Deeper"));
  expect(deep?.title).toBe("Under first");
  expect(deep?.level).toBe(2);
  expect(deep?.body).toBe("Deeper body.");

  const first = org(page, page.indexOf("First body"));
  expect(first?.title).toBe("First");
  expect(first?.level).toBe(1);
  // It stops at the next level-1 heading, and takes the level-2 one with it.
  expect(page.slice(first!.from, first!.to)).toBe(
    "* First\nFirst body.\n\n** Under first\nDeeper body.",
  );
  // The blank line between the sections stays on the page.
  expect(page.charAt(first!.to)).toBe("\n");
});

test("a cursor above the first heading has no subtree", () => {
  const page = "#+title: Source\n\nPreamble.\n\n* A heading\nBody.\n";
  expect(org(page, page.indexOf("Preamble"))).toBeUndefined();
  expect(org(page, page.indexOf("A heading"))?.title).toBe("A heading");
});

test("nested headings are promoted so the shallowest sits at level 1", () => {
  const page = `** Parent
Parent body.

*** Child
Child body.

**** Grandchild
Deep body.

** Next
`;
  const subtree = org(page, 0);
  expect(subtree?.level).toBe(2);
  // The parent heading becomes the title, so its children move up by two.
  expect(subtree?.body).toBe(
    "Parent body.\n\n* Child\nChild body.\n\n** Grandchild\nDeep body.",
  );
});

test("a Markdown subtree is promoted with Markdown markers", () => {
  const page = `## Parent

Parent body.

### Child

Child body.

## Next
`;
  const subtree = md(page, page.indexOf("Parent body"));
  expect(subtree?.title).toBe("Parent");
  expect(subtree?.body).toBe("\nParent body.\n\n# Child\n\nChild body.");
});

test("the title drops the marker, the keyword, the priority and the tags", () => {
  expect(headingParts(parseOrg("* Plain\n").children![0])).toEqual({
    title: "Plain",
    keywords: [],
  });
  expect(
    headingParts(
      parseOrg("* TODO [#A] Pay the filing fee :court:fees:\n").children![0],
    ),
  ).toEqual({ title: "Pay the filing fee", keywords: ["court", "fees"] });
  expect(
    headingParts(
      parseOrg("** DONE Served the notice :service:\n").children![0],
    ),
  ).toEqual({ title: "Served the notice", keywords: ["service"] });
  // A colon inside the title is not a tag list.
  expect(headingParts(parseOrg("* Rule 11: sanctions\n").children![0])).toEqual(
    { title: "Rule 11: sanctions", keywords: [] },
  );
});

test("a Markdown heading's hashtags are its keywords", () => {
  const heading = parseMarkdown("## Hearing notes #court #prep\n").children![0];
  expect(headingParts(heading)).toEqual({
    title: "Hearing notes",
    keywords: ["court", "prep"],
  });
});

test("the same keyword written twice is one keyword", () => {
  const heading = parseMarkdown("## Notes #court #court\n").children![0];
  expect(headingParts(heading).keywords).toEqual(["court"]);
});

test("Org timestamps read as moments, with no time meaning midnight", () => {
  expect(parseOrgTimestamp("[2024-03-04 Mon 09:30]")).toEqual(
    new Date(2024, 2, 4, 9, 30),
  );
  expect(parseOrgTimestamp("<2024-03-04 Mon>")).toEqual(
    new Date(2024, 2, 4, 0, 0),
  );
  expect(parseOrgTimestamp("not a date")).toBeUndefined();
});

test("the heading's date prefers DATE, then CREATED, then CLOSED", () => {
  const all = `CLOSED: [2024-01-01 Mon 08:00]
:PROPERTIES:
:DATE:    [2024-03-04 Mon 09:30]
:CREATED: [2024-02-02 Fri 10:00]
:END:
`;
  expect(headingDate(all)).toEqual(new Date(2024, 2, 4, 9, 30));
  expect(headingDate(all.replace(/^:DATE:.*\n/m, ""))).toEqual(
    new Date(2024, 1, 2, 10, 0),
  );
  expect(
    headingDate(all.replace(/^:DATE:.*\n/m, "").replace(/^:CREATED:.*\n/m, "")),
  ).toEqual(new Date(2024, 0, 1, 8, 0));
  expect(headingDate("Just a body line.\n")).toBeUndefined();
});

test("the date is read off the subtree's own heading", () => {
  const page = `* Filed the motion :court:
CLOSED: [2024-03-04 Mon 09:30]
Body.

* Something else
:PROPERTIES:
:DATE: [2020-01-01 Wed]
:END:
`;
  const subtree = org(page, page.indexOf("Body"));
  expect(subtree?.date).toEqual(new Date(2024, 2, 4, 9, 30));
  expect(subtree?.keywords).toEqual(["court"]);
  // A nested drawer further down is not this heading's date.
  expect(org(page, page.indexOf("Something"))?.date).toEqual(
    new Date(2020, 0, 1),
  );
});

test("a property drawer stays in the body, as Denote keeps it for review", () => {
  const page = `* Hearing
:PROPERTIES:
:DATE: [2024-03-04 Mon]
:END:
Body.
`;
  expect(org(page, 0)?.body).toContain(":PROPERTIES:");
});

test("the new note's file type follows the page it came from", () => {
  expect(extractedFileType("notes.org", "#+title: x\n")).toBe("org");
  expect(extractedFileType("notes.md", "---\ntitle: x\n---\n")).toBe(
    "markdown-yaml",
  );
  // Denote sniffs the opening fence for TOML.
  expect(extractedFileType("notes.md", "+++\ntitle = 'x'\n+++\n")).toBe(
    "markdown-toml",
  );
  // There is no front matter spec that can create a `text` note, so a file
  // type that cannot be written is never the answer.
  expect(extractedFileType("notes.txt", "")).toBe("markdown-yaml");
});

test("a heading with nothing under it extracts to an empty body", () => {
  const page = "* Just a heading\n\n* Next\n";
  const subtree = org(page, 0);
  expect(subtree?.title).toBe("Just a heading");
  expect(subtree?.body).toBe("");
  expect(page.slice(subtree!.from, subtree!.to)).toBe("* Just a heading");
});

test("the last subtree on a page runs to the end of the text", () => {
  const page = "* One\nBody.\n\n* Last\nFinal body.\n\n\n";
  const subtree = org(page, page.indexOf("Final"));
  expect(subtree?.body).toBe("Final body.");
  // Trailing blank lines belong to the page, not the section.
  expect(subtree?.to).toBe(page.indexOf("Final body.") + "Final body.".length);
});

import { expect, test } from "vitest";
import {
  createsDenoteNote,
  denotePromptNames,
  parseKeywordInput,
  promptsWith,
  readPromptNames,
} from "./denote.ts";

test("Keywords split on commas, as Denote's completing-read-multiple does", () => {
  // Whitespace does *not* separate keywords: a multi-word keyword is joined by
  // sluggification, which is why the real library contains `genuineissuetrial`.
  expect(parseKeywordInput("Case Law, trust")).toEqual(["caselaw", "trust"]);
  expect(parseKeywordInput("genuine issue trial")).toEqual([
    "genuineissuetrial",
  ]);
  expect(parseKeywordInput("case,law")).toEqual(["case", "law"]);
  expect(parseKeywordInput("  case ,  law  ")).toEqual(["case", "law"]);
});

test("Keywords are de-duplicated and sorted", () => {
  expect(parseKeywordInput("law, case, law")).toEqual(["case", "law"]);
  expect(parseKeywordInput("Law, CASE")).toEqual(["case", "law"]);
});

test("An empty answer means no keywords", () => {
  expect(parseKeywordInput("")).toEqual([]);
  expect(parseKeywordInput("   ")).toEqual([]);
  expect(parseKeywordInput(", ,")).toEqual([]);
});

const aNote = "20240125T164237--court-costs__costs_law.org";

test("Creating from a Denote note mints a Denote note", () => {
  // The bug this replaced: the picker's create row navigated to the phrase,
  // which in a Denote library made `Some New Note.md` -- no identifier, outside
  // the naming scheme, unreachable by every `denote:` link.
  expect(createsDenoteNote("Some New Note", aNote)).toBe(true);
  expect(createsDenoteNote("  Some New Note  ", aNote)).toBe(true);
});

test("Creating from an ordinary page is left alone", () => {
  // A space can hold both, and a stock Markdown space must not change.
  expect(createsDenoteNote("Some New Note", "Library/Std/Config.md")).toBe(
    false,
  );
  expect(createsDenoteNote("Some New Note", "")).toBe(false);
});

test("A phrase naming a file is taken literally", () => {
  // Denote is flat and derives the name from the title, so a path or an
  // extension means the phrase was meant as a file name.
  expect(createsDenoteNote("notes/scratch", aNote)).toBe(false);
  expect(createsDenoteNote("scratch.md", aNote)).toBe(false);
  expect(createsDenoteNote("scratch.org", aNote)).toBe(false);
  expect(createsDenoteNote("scratch.TXT", aNote)).toBe(false);
  // A title ending in something dot-like is still a title.
  expect(createsDenoteNote("Rule 5.2", aNote)).toBe(true);
});

test("An empty phrase creates nothing", () => {
  expect(createsDenoteNote("", aNote)).toBe(false);
  expect(createsDenoteNote("   ", aNote)).toBe(false);
});

// `denote-prompts`: the list that makes one creation command out of seven.

test("Unset means Denote's own default, not no prompts", () => {
  // The distinction matters: a space with no `denote.prompts` should ask for a
  // title and keywords, while someone who wrote `denote.prompts = {}` has said
  // to ask nothing and mean it.
  expect(readPromptNames(undefined).prompts).toEqual(["title", "keywords"]);
  expect(readPromptNames(null).prompts).toEqual(["title", "keywords"]);
  expect(readPromptNames("title").prompts).toEqual(["title", "keywords"]);
  expect(readPromptNames([]).prompts).toEqual([]);
});

test("The configured order is the order asked", () => {
  expect(readPromptNames(["keywords", "title"]).prompts).toEqual([
    "keywords",
    "title",
  ]);
  expect(
    readPromptNames(["title", "subdirectory", "keywords"]).prompts,
  ).toEqual(["title", "subdirectory", "keywords"]);
});

test("Every prompt name Denote uses is accepted", () => {
  // The hyphen in `file-type` is Denote's spelling, so a `denote-prompts`
  // value translates across without being rewritten.
  expect(readPromptNames([...denotePromptNames])).toEqual({
    prompts: [...denotePromptNames],
    unknown: [],
  });
});

test("An unrecognised prompt is dropped and reported", () => {
  // Dropped so a typo cannot stop you making a note; reported so a misspelled
  // `title` does not quietly produce untitled ones.
  const read = readPromptNames(["title", "titel", "keywords"]);
  expect(read.prompts).toEqual(["title", "keywords"]);
  expect(read.unknown).toEqual(["titel"]);
});

test("A prompt asked twice is asked once, where it was first put", () => {
  const read = readPromptNames(["keywords", "title", "keywords"]);
  expect(read.prompts).toEqual(["keywords", "title"]);
  expect(read.unknown).toEqual([]);
});

test("Blank entries are not prompts and are not complained about", () => {
  const read = readPromptNames(["title", "", "   ", "keywords"]);
  expect(read.prompts).toEqual(["title", "keywords"]);
  expect(read.unknown).toEqual([]);
});

test("A variant appends its own prompt", () => {
  // `denote-signature` is `denote-prompts` plus `signature`, asked last.
  expect(promptsWith(["title", "keywords"], "signature")).toEqual([
    "title",
    "keywords",
    "signature",
  ]);
  expect(promptsWith(["title", "keywords"])).toEqual(["title", "keywords"]);
});

test("A variant's prompt stays where the configuration put it", () => {
  // Someone who configured `signature` first meant to be asked first, and
  // `Denote: New Note with Signature` should not ask again at the end.
  expect(promptsWith(["signature", "title"], "signature")).toEqual([
    "signature",
    "title",
  ]);
});

test("Appending leaves the configured list alone", () => {
  // The list is read once per command and handed to every variant, so a
  // variant that mutated it would leak its extra prompt into the next one.
  const configured = readPromptNames(["title"]).prompts;
  promptsWith(configured, "date");
  expect(configured).toEqual(["title"]);
});

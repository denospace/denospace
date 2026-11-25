// Conformance gate for `denote_slug.ts`.
//
// The fixture is 1,713 recorded input/output triples of the Emacs tool these
// file names have to interoperate with — every printable ASCII character in
// four positions, for all four components, plus unicode and separator-run
// cases. It is the specification: to change behaviour, re-probe the reference
// tool with `tools/denote-slug-oracle/oracle.el` and update the fixture.
// Never read the reference implementation. See `PROVENANCE.md`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type DenoteComponent, sluggify } from "./denote_slug.ts";

const FIXTURE = join(
  import.meta.dirname,
  "../../tools/denote-slug-oracle/oracle-pairs.tsv",
);
const unescapeTab = (s: string) => s.replaceAll("\\t", "\t");

test("every recorded reference pair reproduces exactly", () => {
  const lines = readFileSync(FIXTURE, "utf8").split("\n").filter((l) => l !== "");
  expect(lines.length).toBe(1713);

  const failures: string[] = [];
  for (const line of lines) {
    const [component, rawInput, rawExpected = ""] = line.split("\t");
    const input = unescapeTab(rawInput);
    const expected = unescapeTab(rawExpected);
    const actual = sluggify(component as DenoteComponent, input);
    if (actual !== expected) {
      failures.push(
        `${component}  in=${JSON.stringify(input)}  want=${JSON.stringify(expected)}  got=${JSON.stringify(actual)}`,
      );
    }
  }
  expect(failures.join("\n") || "none").toBe("none");
});

test("only the plain space separates words", () => {
  // The rule most likely to be "fixed" into a bug: every other space-like
  // character is an ordinary kept character.
  expect(sluggify("title", "a\tb")).toBe("a\tb");
  expect(sluggify("title", "a b")).toBe("a b");
  expect(sluggify("title", "x y z")).toBe("x-y z");
  expect(sluggify("title", "a b")).toBe("a-b");
});

test("each component recognises only its own joining mark", () => {
  expect(sluggify("title", "a=b")).toBe("ab");
  expect(sluggify("title", "a b")).toBe("a-b");
  expect(sluggify("signature", "a-b")).toBe("ab");
  expect(sluggify("signature", "a b")).toBe("a=b");
  expect(sluggify("keyword", "genuine issue trial")).toBe("genuineissuetrial");
});

test("sluggify is total, deterministic and idempotent on its own output", () => {
  const components: DenoteComponent[] = [
    "identifier",
    "signature",
    "title",
    "keyword",
  ];
  for (const c of components) {
    expect(typeof sluggify(c, "")).toBe("string");
    const once = sluggify(c, "Some Mixed _Input- Here");
    expect(sluggify(c, "Some Mixed _Input- Here")).toBe(once);
    expect(sluggify(c, once)).toBe(once);
  }
});

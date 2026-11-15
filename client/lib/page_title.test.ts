import { describe, expect, test } from "vitest";
import { pageTitle } from "./page_title.ts";

const NAME = "20260706T090036==25=00--acorn-medic__likenow_mission.org";

describe("pageTitle", () => {
  test("uses the indexed title, which keeps its capitals", () => {
    expect(pageTitle(NAME, { title: "Acorn Medic" })).toBe("Acorn Medic");
  });

  test("falls back to the name's own title when the index has not caught up", () => {
    // A note created a moment ago, or a cold start: the file name is the one
    // thing always to hand, and its title is a slug.
    expect(pageTitle(NAME)).toBe("acorn medic");
    expect(pageTitle(NAME, {})).toBe("acorn medic");
    expect(pageTitle(NAME, { title: "   " })).toBe("acorn medic");
  });

  test("leaves a page that is not a Denote note as its name", () => {
    expect(pageTitle("Library/Std/Config.md")).toBe("Library/Std/Config.md");
    expect(pageTitle("index.md")).toBe("index.md");
  });

  test("keeps a page decoration's prefix in front of whichever it picks", () => {
    const decorated = { pageDecoration: { prefix: "🔥 " } };
    expect(pageTitle(NAME, { ...decorated, title: "Acorn Medic" })).toBe(
      "🔥 Acorn Medic",
    );
    expect(pageTitle(NAME, decorated)).toBe("🔥 acorn medic");
    expect(pageTitle("index.md", decorated)).toBe("🔥 index.md");
  });

  test("a title with no name part falls back rather than showing the stamp", () => {
    // `parseDenoteName` gives an identifier and no title for this one, and a
    // bare timestamp says less in a tab than the file name does.
    expect(pageTitle("20260706T090036.org")).toBe("20260706T090036.org");
  });
});

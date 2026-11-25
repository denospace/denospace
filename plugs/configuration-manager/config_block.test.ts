import { describe, expect, test } from "vitest";
import {
  findManagedBlock,
  replaceManagedBlock,
  syntaxForPath,
} from "./config_block.ts";

const MARKER = "-- managed-by: configuration-manager";

describe("findManagedBlock", () => {
  test("finds block in simple config page", () => {
    const text = `Some text

\`\`\`space-lua
${MARKER}
config.set("shortWikiLinks", false)
\`\`\`
`;
    const result = findManagedBlock(text);
    expect(result).not.toBeNull();
    expect(result!.innerContent).toContain(MARKER);
    expect(result!.innerContent).toContain("shortWikiLinks");
  });

  test("returns null when no managed block exists", () => {
    const text = `Some text

\`\`\`space-lua
config.set("vim", {})
\`\`\`
`;
    expect(findManagedBlock(text)).toBeNull();
  });

  test("finds correct block when multiple space-lua blocks exist", () => {
    const text = `\`\`\`space-lua
config.set("other", true)
\`\`\`

\`\`\`space-lua
${MARKER}
config.set("a", 1)
\`\`\`
`;
    const result = findManagedBlock(text);
    expect(result).not.toBeNull();
    expect(result!.innerContent).toContain('"a", 1');
    expect(result!.innerContent).not.toContain('"other"');
  });
});

describe("replaceManagedBlock", () => {
  test("replaces existing managed block", () => {
    const text = `Intro text

\`\`\`space-lua
${MARKER}
config.set("old", true)
\`\`\`

Trailing text
`;
    const newContent = `${MARKER}\nconfig.set("new", true)`;
    const result = replaceManagedBlock(text, newContent);
    expect(result).toContain('"new", true');
    expect(result).not.toContain('"old", true');
    expect(result).toContain("Intro text");
    expect(result).toContain("Trailing text");
  });

  test("appends new block when none exists", () => {
    const text = `Intro text

\`\`\`space-lua
config.set("manual", true)
\`\`\`
`;
    const newContent = `${MARKER}\nconfig.set("ui", true)`;
    const result = replaceManagedBlock(text, newContent);
    expect(result).toContain("manual");
    expect(result).toContain('"ui", true');
    expect(result).toContain(`\`\`\`space-lua\n${newContent}\n\`\`\``);
  });

  test("removes managed block when new content is empty", () => {
    const text = `Intro

\`\`\`space-lua
${MARKER}
config.set("old", true)
\`\`\`

End
`;
    const result = replaceManagedBlock(text, "");
    expect(result).not.toContain(MARKER);
    expect(result).toContain("Intro");
    expect(result).toContain("End");
  });
});

// An Org space has no backtick fence: a ```space-lua block pasted into an Org
// page is a paragraph that silently does nothing, so a config page written in
// Org states its block as `#+BEGIN_SRC space-lua`. The Configuration Manager
// has to read and write that form, or the UI would append a second, Markdown
// block that the Org page never runs.
describe("an Org config page", () => {
  const orgPage = (body: string) => `#+TITLE: CONFIG

${body}
`;

  test("its managed block is found", () => {
    const text = orgPage(
      `#+BEGIN_SRC space-lua\n${MARKER}\nconfig.set("a", 1)\n#+END_SRC`,
    );
    const found = findManagedBlock(text);
    expect(found).not.toBeNull();
    expect(found!.syntax).toEqual("org");
    expect(found!.innerContent).toContain('"a", 1');
  });

  test("a lowercase block is found too, and keeps its casing", () => {
    const text = orgPage(
      `#+begin_src space-lua\n${MARKER}\nconfig.set("a", 1)\n#+end_src`,
    );
    expect(findManagedBlock(text)).not.toBeNull();
    const result = replaceManagedBlock(
      text,
      `${MARKER}\nconfig.set("b", 2)`,
      "org",
    );
    // Rewriting with the page's own markers, rather than regenerating them,
    // keeps the UI from churning a hand-written page into another casing.
    expect(result).toContain("#+begin_src space-lua");
    expect(result).toContain("#+end_src");
    expect(result).not.toContain("#+BEGIN_SRC");
    expect(result).toContain('"b", 2');
  });

  test("an unmanaged Org block is left alone", () => {
    const text = orgPage(
      `#+BEGIN_SRC space-lua\nconfig.set("mine", true)\n#+END_SRC`,
    );
    expect(findManagedBlock(text)).toBeNull();
  });

  test("an appended block is Org, not a backtick fence", () => {
    const text = orgPage(
      `#+BEGIN_SRC space-lua\nconfig.set("mine", true)\n#+END_SRC`,
    );
    const result = replaceManagedBlock(
      text,
      `${MARKER}\nconfig.set("ui", true)`,
      "org",
    );
    expect(result).toContain(`#+BEGIN_SRC space-lua\n${MARKER}`);
    expect(result).not.toContain("```");
    expect(result).toContain('"mine", true');
  });

  test("removing the managed block leaves the rest of the page", () => {
    const text = orgPage(
      `#+BEGIN_SRC space-lua\n${MARKER}\nconfig.set("old", true)\n#+END_SRC`,
    );
    const result = replaceManagedBlock(text, "", "org");
    expect(result).not.toContain(MARKER);
    expect(result).not.toContain("#+BEGIN_SRC");
    expect(result).toContain("#+TITLE: CONFIG");
  });

  test("the managed block is picked out from among several", () => {
    const text = orgPage(
      `#+BEGIN_SRC space-lua\nconfig.set("other", true)\n#+END_SRC\n\n` +
        `#+BEGIN_SRC space-lua\n${MARKER}\nconfig.set("a", 1)\n#+END_SRC`,
    );
    const found = findManagedBlock(text);
    expect(found!.innerContent).toContain('"a", 1');
    expect(found!.innerContent).not.toContain('"other"');
  });
});

describe("syntaxForPath", () => {
  test("reads the markup off the page's extension", () => {
    expect(syntaxForPath("CONFIG.org")).toEqual("org");
    expect(syntaxForPath("CONFIG.ORG")).toEqual("org");
    expect(syntaxForPath("CONFIG.md")).toEqual("markdown");
    // An extensionless page name is Markdown, which is what the rest of the
    // app resolves a bare name to.
    expect(syntaxForPath("CONFIG")).toEqual("markdown");
  });
});

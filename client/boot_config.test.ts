import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText, loadConfig } from "./boot_config.ts";

test("Test boot config", () => {
  // One block present
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```space-lua\ntest()\n```\nMore"),
  ).toEqual("test()");
  // Two blocks present
  expect(
    extractSpaceLuaFromPageText(
      "Hello\n\n```space-lua\ntest()\n```\nMore\n\n```space-lua\ntest2()\n```",
    ),
  ).toEqual("test()\ntest2()");
  // No lua present
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```lua\ntest()\n```\nMore"),
  ).toEqual("");
  // A commented-out block is disabled
  expect(
    extractSpaceLuaFromPageText(
      "```space-lua\nlive = 1\n```\n\n<!--\n\n```space-lua\ncommented = 2\n```\n\n-->\n",
    ),
  ).toEqual("live = 1");
});

test("Test CONFIG lua eval", async () => {
  // Test base case: no config code
  let config = await loadConfig("", {}, false);
  expect(config.values).toEqual({});

  // Check a few config sets
  config = await loadConfig(
    `
    config.set {
      option1 = "pete"
    }
    config.set("optionObj.nested", 5)
`,
    {},
    false,
  );
  expect(config.values).toEqual({
    option1: "pete",
    optionObj: {
      nested: 5,
    },
  });

  // Check random Lua code crap resilience
  config = await loadConfig(
    `
    config.set {
      option1 = "pete"
    }
    slashCommand.define {}
    local shouldSet = true
    if shouldSet then
      config.set("optionObj.nested", 5)
    end
`,
    {},
    false,
  );
  expect(config.values).toEqual({
    option1: "pete",
    optionObj: {
      nested: 5,
    },
  });
});

// An Org page states a space-lua block as `#+BEGIN_SRC space-lua`, which the
// Markdown parser reads as an ordinary paragraph. Parsing `CONFIG.org` as
// Markdown therefore finds no code at all and the space boots with none of
// its own configuration -- with nothing to show that it happened.

test("an Org page's space-lua is extracted", () => {
  expect(
    extractSpaceLuaFromPageText(
      "Intro\n\n#+BEGIN_SRC space-lua\nconfig.set('a', 1)\n#+END_SRC\n",
      ".fs/CONFIG.org",
    ),
  ).toEqual("config.set('a', 1)");
});

test("an Org page parsed as Markdown yields nothing", () => {
  // Stated so the reason the `path` argument exists cannot be refactored
  // away by accident.
  expect(
    extractSpaceLuaFromPageText(
      "#+BEGIN_SRC space-lua\nconfig.set('a', 1)\n#+END_SRC\n",
    ),
  ).toEqual("");
});

test("several blocks are joined, in order", () => {
  expect(
    extractSpaceLuaFromPageText(
      "#+BEGIN_SRC space-lua\nfirst()\n#+END_SRC\n\n#+BEGIN_SRC space-lua\nsecond()\n#+END_SRC\n",
      "CONFIG.org",
    ),
  ).toEqual("first()\nsecond()");
});

test("a commented-out block stays disabled in an Org page too", () => {
  // Commenting a script out is how it gets turned off; an Org comment block
  // has to count for that as much as a Markdown one.
  expect(
    extractSpaceLuaFromPageText(
      "#+BEGIN_COMMENT\n#+BEGIN_SRC space-lua\nnope()\n#+END_SRC\n#+END_COMMENT\n",
      "CONFIG.org",
    ),
  ).toEqual("");
});

test("the extension is matched regardless of case", () => {
  expect(
    extractSpaceLuaFromPageText(
      "#+BEGIN_SRC space-lua\nyes()\n#+END_SRC\n",
      "CONFIG.ORG",
    ),
  ).toEqual("yes()");
});

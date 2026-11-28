import { expect, test, vi } from "vitest";

/**
 * `createActivate` exercised directly against a minimal fake engine, pinning
 * the carried-dropdown contract: a `dropdown` value in the activation applies
 * to that activation only (never persisted), and the next open without one
 * restores the remembered selection.
 */

const datastore = {
  get: vi.fn<(key: unknown[]) => Promise<unknown>>(),
  set: vi.fn<(key: unknown[], value: unknown) => Promise<void>>(),
};
const editor = {
  getCurrentPage: vi.fn<() => Promise<string>>(async () => "Page"),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore,
  editor,
}));

const { createActivate } = await import("./activation.ts");
import {
  ancestorPaths,
  withExpanded,
} from "../../../plug-api/ui/tree_model.ts";

function makeHarness(remembered: unknown, dropdownDefault?: string) {
  datastore.get.mockReset();
  datastore.set.mockReset();
  datastore.get.mockImplementation((key: unknown[]) =>
    Promise.resolve(
      Array.isArray(key) && key[2] === "dropdown" ? remembered : undefined,
    ),
  );
  const state = {
    meta: { name: "inbox", dropdown: { placeholder: "Recipient" } },
    ctx: { phrase: "" },
    dropdownOptions: [
      { label: "Pete", value: "People/Pete" },
      { label: "Sales", value: "recipient:sales" },
    ],
    dropdownDefault,
  };
  const engine = {
    dropIfRedefined: vi.fn(async () => false),
    dropIfEphemeral: vi.fn(),
    isLoaded: vi.fn(() => false),
    activate: vi.fn(async () => state),
    activeState: vi.fn(() => state),
    refresh: vi.fn(async () => {}),
  };
  const ref = <T>(value: T) => ({ current: value });
  const refs = {
    displayed: ref<string | undefined>(undefined),
    handledToken: ref<number | undefined>(undefined),
    segmentForced: ref(false),
    dropdownForced: ref(false),
    revealedFor: ref<string | undefined>(undefined),
    revealedPage: ref<string | undefined>(undefined),
    view: ref<any>(undefined),
    phrase: ref(""),
    interaction: ref<"typing" | "navigating">("typing"),
    returnTo: ref<string | undefined>(undefined),
    segmentDirty: ref(false),
    dropdownDirty: ref(false),
    expandedDirty: ref(false),
    lastQueried: ref<string | undefined>(undefined),
    readySignaledToken: ref<number | undefined>(undefined),
  };
  const setDropdownValue = vi.fn();
  const set = {
    setView: vi.fn(),
    setBootError: vi.fn(),
    setPhrase: vi.fn(),
    setSegmentIndex: vi.fn(),
    setDropdownValue,
    setSelectedIndex: vi.fn(),
    setSelectedPath: vi.fn(),
    setExpanded: vi.fn(),
  };
  const activate = createActivate({
    slot: "rhs",
    engine: engine as any,
    refs: refs as any,
    listenForRefresh: vi.fn(),
    set: set as any,
    publish: vi.fn(),
    syncReadOnly: vi.fn(async () => {}),
    applyReveal: vi.fn(),
    focusInput: vi.fn(),
    signalReady: vi.fn(),
  });
  return { activate, setDropdownValue, refs };
}

async function settled() {
  // Lets the fire-and-forget datastore reads inside activate land.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a carried dropdown value applies to that activation only, unpersisted", async () => {
  const { activate, setDropdownValue } = makeHarness("People/Pete");

  await activate({
    view: "inbox",
    token: 1,
    dropdown: "recipient:sales",
    focus: false,
  });
  await settled();
  expect(setDropdownValue).toHaveBeenCalledWith("recipient:sales");
  // Ephemeral by design: the carried value is never written back.
  expect(datastore.set).not.toHaveBeenCalled();

  // The next open without a carried value restores the remembered
  // (hand-picked) selection rather than staying on the forced one.
  setDropdownValue.mockClear();
  await activate({ view: "inbox", token: 2 });
  await settled();
  expect(setDropdownValue).toHaveBeenCalledWith(undefined);
  expect(setDropdownValue).toHaveBeenLastCalledWith("People/Pete");
});

test("without a remembered value, the open after a carried one is back on All", async () => {
  const { activate, setDropdownValue } = makeHarness(undefined);

  await activate({
    view: "inbox",
    token: 1,
    dropdown: "recipient:sales",
    focus: false,
  });
  await settled();
  expect(setDropdownValue).toHaveBeenLastCalledWith("recipient:sales");

  setDropdownValue.mockClear();
  await activate({ view: "inbox", token: 2 });
  await settled();
  // Nothing remembered: the reset to the built-in "All" is the last word.
  expect(setDropdownValue).toHaveBeenLastCalledWith(undefined);
});

test("dropdown.default applies when nothing is remembered", async () => {
  const { activate, setDropdownValue } = makeHarness(
    undefined,
    "recipient:sales",
  );

  await activate({ view: "inbox", token: 1 });
  await settled();
  expect(setDropdownValue).toHaveBeenLastCalledWith("recipient:sales");
});

test("a remembered value wins over dropdown.default", async () => {
  const { activate, setDropdownValue } = makeHarness(
    "People/Pete",
    "recipient:sales",
  );

  await activate({ view: "inbox", token: 1 });
  await settled();
  expect(setDropdownValue).toHaveBeenLastCalledWith("People/Pete");
});

test("a dropdown.default that is not among the options is ignored", async () => {
  const { activate, setDropdownValue } = makeHarness(
    undefined,
    "recipient:ghost",
  );

  await activate({ view: "inbox", token: 1 });
  await settled();
  expect(setDropdownValue).not.toHaveBeenCalledWith("recipient:ghost");
  expect(setDropdownValue).toHaveBeenLastCalledWith(undefined);
});

test("the open after a carried value falls back to dropdown.default", async () => {
  const { activate, setDropdownValue } = makeHarness(
    undefined,
    "recipient:sales",
  );

  await activate({
    view: "inbox",
    token: 1,
    dropdown: "People/Pete",
    focus: false,
  });
  await settled();

  setDropdownValue.mockClear();
  await activate({ view: "inbox", token: 2 });
  await settled();
  expect(setDropdownValue).toHaveBeenLastCalledWith("recipient:sales");
});

test("a remembered 'All' outranks dropdown.default", async () => {
  // `pickDropdown` persists the built-in All as null, distinct from the
  // undefined of a view whose dropdown was never touched.
  const { activate, setDropdownValue } = makeHarness(null, "recipient:sales");

  await activate({ view: "inbox", token: 1 });
  await settled();
  expect(setDropdownValue).not.toHaveBeenCalledWith("recipient:sales");
  expect(setDropdownValue).toHaveBeenLastCalledWith(undefined);
});

/**
 * The remembered expansion set, for a tree view. Separate harness from the
 * dropdown one above: this needs `mode: "tree"` metadata and a stored
 * expansion key rather than a dropdown.
 */
function makeTreeHarness({
  expandAll,
  stored,
  revealedPage,
}: {
  expandAll: boolean;
  stored: string[];
  revealedPage?: string;
}) {
  datastore.get.mockReset();
  datastore.set.mockReset();
  datastore.get.mockImplementation((key: unknown[]) =>
    Promise.resolve(
      Array.isArray(key) && (key[2] === "collapsed" || key[2] === "expanded")
        ? stored
        : undefined,
    ),
  );
  const state = {
    meta: {
      name: "tree",
      mode: "tree",
      expandAll,
      hierarchy: { separator: "/" },
    },
    ctx: { phrase: "" },
  };
  const engine = {
    dropIfRedefined: vi.fn(async () => false),
    dropIfEphemeral: vi.fn(),
    isLoaded: vi.fn(() => false),
    activate: vi.fn(async () => state),
    activeState: vi.fn(() => state),
    refresh: vi.fn(async () => {}),
  };
  const ref = <T>(value: T) => ({ current: value });
  const refs = {
    displayed: ref<string | undefined>(undefined),
    handledToken: ref<number | undefined>(undefined),
    segmentForced: ref(false),
    dropdownForced: ref(false),
    revealedFor: ref<string | undefined>(undefined),
    revealedPage: ref<string | undefined>(revealedPage),
    view: ref<any>(undefined),
    phrase: ref(""),
    interaction: ref<"typing" | "navigating">("typing"),
    returnTo: ref<string | undefined>(undefined),
    segmentDirty: ref(false),
    dropdownDirty: ref(false),
    expandedDirty: ref(false),
    lastQueried: ref<string | undefined>(undefined),
    readySignaledToken: ref<number | undefined>(undefined),
  };
  // `setExpanded` is called with an updater; this applies them in order, the
  // way the real state would.
  let expanded = new Set<string>();
  const set = {
    setView: vi.fn(),
    setBootError: vi.fn(),
    setPhrase: vi.fn(),
    setSegmentIndex: vi.fn(),
    setDropdownValue: vi.fn(),
    setSelectedIndex: vi.fn(),
    setSelectedPath: vi.fn(),
    setExpanded: vi.fn((next: any) => {
      expanded = typeof next === "function" ? next(expanded) : next;
    }),
  };
  const activate = createActivate({
    slot: "lhs",
    engine: engine as any,
    refs: refs as any,
    listenForRefresh: vi.fn(),
    set: set as any,
    publish: vi.fn(),
    syncReadOnly: vi.fn(async () => {}),
    applyReveal: vi.fn(),
    focusInput: vi.fn(),
    signalReady: vi.fn(),
  });
  return { activate, expanded: () => [...expanded].sort() };
}

test("an expandAll tree comes back with the folders it was left collapsed", async () => {
  // The bug this pins: the restore used to run the stored set through
  // `withExpanded`, which under `expandAll` *removes* -- subtracting the
  // stored set from an empty one and discarding all of it. Every collapsed
  // folder in such a tree reopened on reload.
  const { activate, expanded } = makeTreeHarness({
    expandAll: true,
    stored: ["Alpha", "Beta/deep"],
  });
  await activate({ view: "tree", token: 1, focus: false });
  await settled();
  expect(expanded()).toEqual(["Alpha", "Beta/deep"]);
});

test("a plain tree comes back with the folders it was left open", async () => {
  const { activate, expanded } = makeTreeHarness({
    expandAll: false,
    stored: ["Alpha"],
  });
  await activate({ view: "tree", token: 1, focus: false });
  await settled();
  expect(expanded()).toEqual(["Alpha"]);
});

/**
 * The reveal/restore race, driven both ways round.
 *
 * `followEditor` reveals the current page on the way in, which under
 * `expandAll` means removing its ancestors from the collapsed set, while the
 * stored set is read in a separate round trip with no fixed order against it.
 * Both orders have to land on the same answer, so this harness holds each one
 * open until the test says go.
 */
function makeRaceHarness(stored: string[]) {
  datastore.get.mockReset();
  datastore.set.mockReset();
  // Both resolvers armed up front, not when the call arrives: the tail's
  // `getCurrentPage` happens several awaits in, and a releaser created there
  // would still be a no-op when the test reached for it.
  let releaseStored: () => void = () => {};
  const storedRead = new Promise<unknown>((resolve) => {
    releaseStored = () => resolve(stored);
  });
  let releasePage: () => void = () => {};
  const pageRead = new Promise<string>((resolve) => {
    releasePage = () => resolve("Alpha/one");
  });
  datastore.get.mockImplementation((key: unknown[]) =>
    Array.isArray(key) && key[2] === "collapsed"
      ? storedRead
      : Promise.resolve(undefined),
  );
  editor.getCurrentPage.mockImplementation(() => pageRead);

  const meta = {
    name: "tree",
    mode: "tree",
    expandAll: true,
    followEditor: true,
    hierarchy: { separator: "/" },
  };
  const state = { meta, ctx: { phrase: "" } };
  const engine = {
    dropIfRedefined: vi.fn(async () => false),
    dropIfEphemeral: vi.fn(),
    isLoaded: vi.fn(() => false),
    activate: vi.fn(async () => state),
    activeState: vi.fn(() => state),
    refresh: vi.fn(async () => {}),
  };
  const ref = <T,>(value: T) => ({ current: value });
  const refs = {
    displayed: ref<string | undefined>(undefined),
    handledToken: ref<number | undefined>(undefined),
    segmentForced: ref(false),
    dropdownForced: ref(false),
    revealedFor: ref<string | undefined>(undefined),
    revealedPage: ref<string | undefined>(undefined),
    view: ref<any>({ name: "tree", meta }),
    phrase: ref(""),
    interaction: ref<"typing" | "navigating">("typing"),
    returnTo: ref<string | undefined>(undefined),
    segmentDirty: ref(false),
    dropdownDirty: ref(false),
    expandedDirty: ref(false),
    lastQueried: ref<string | undefined>(undefined),
    readySignaledToken: ref<number | undefined>(undefined),
  };
  let expanded = new Set<string>();
  const apply = (next: any) => {
    expanded = typeof next === "function" ? next(expanded) : next;
  };
  const activate = createActivate({
    slot: "lhs",
    engine: engine as any,
    refs: refs as any,
    listenForRefresh: vi.fn(),
    set: {
      setView: vi.fn(),
      setBootError: vi.fn(),
      setPhrase: vi.fn(),
      setSegmentIndex: vi.fn(),
      setDropdownValue: vi.fn(),
      setSelectedIndex: vi.fn(),
      setSelectedPath: vi.fn(),
      setExpanded: vi.fn(apply),
    } as any,
    publish: vi.fn(),
    syncReadOnly: vi.fn(async () => {}),
    // Exactly what `usePanelEvents`'s own `applyReveal` does to these two.
    applyReveal: (name: string) => {
      refs.revealedPage.current = name;
      apply((prev: Set<string>) =>
        withExpanded(prev, ancestorPaths(name, "/"), true),
      );
    },
    focusInput: vi.fn(),
    signalReady: vi.fn(),
  });
  return {
    activate,
    releaseStored: () => releaseStored(),
    releasePage: () => releasePage(),
    expanded: () => [...expanded].sort(),
  };
}

test("the reveal outranks the stored collapse, whichever lands first", async () => {
  // `Alpha` is stored shut, but the editor is on `Alpha/one`: going there is
  // the newer intent, so that row stays visible. `Beta` keeps its collapse.
  for (const revealFirst of [true, false]) {
    const h = makeRaceHarness(["Alpha", "Beta"]);
    const activating = h.activate({ view: "tree", token: 1, focus: false });
    if (revealFirst) {
      h.releasePage();
      await settled();
      h.releaseStored();
    } else {
      h.releaseStored();
      await settled();
      h.releasePage();
    }
    await activating;
    await settled();
    expect(h.expanded(), `revealFirst=${revealFirst}`).toEqual(["Beta"]);
  }
});

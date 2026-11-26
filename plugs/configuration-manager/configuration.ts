import {
  asset,
  config,
  editor,
  mq,
  space,
  sync,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { buildConfigurationHtml } from "./configuration_html.ts";
import { type CommandOverride, parseManagedBlock, toLua } from "./lua.ts";
import { pathFromPageName } from "@silverbulletmd/silverbullet/lib/ref";
import {
  findManagedBlock,
  MANAGED_MARKER,
  type PageSyntax,
  replaceManagedBlock,
  syntaxForPath,
} from "./config_block.ts";
import { listLibraries } from "./libraries.ts";
import type { LibrariesFocus, TabId } from "./ui/types.ts";

const CONFIG_PAGE = "CONFIG";
/**
 * An Org page carries its extension in its name, so the Org config page is
 * `CONFIG.org` where the Markdown one is the bare name `CONFIG`.
 */
const ORG_CONFIG_PAGE = "CONFIG.org";
const PLUG_NAME = "configuration-manager";

type ConfigPage = {
  /** The page name to read and write. */
  name: string;
  /** Its current text, empty when the page does not exist yet. */
  text: string;
  /** The markup it is written in, which decides how a block is spelled. */
  syntax: PageSyntax;
};

async function readPageOrNull(name: string): Promise<string | null> {
  try {
    return await space.readPage(name);
  } catch {
    return null;
  }
}

/**
 * The config page this space uses.
 *
 * A space that already has one keeps it, whichever markup it is in, so an
 * existing `CONFIG.md` is never orphaned or silently converted. A space with
 * neither gets Org, because a new space here is an Org space -- the same
 * reasoning that makes the seeded index page an Org file.
 */
async function resolveConfigPage(): Promise<ConfigPage> {
  for (const name of [ORG_CONFIG_PAGE, CONFIG_PAGE]) {
    const text = await readPageOrNull(name);
    if (text !== null) {
      return { name, text, syntax: syntaxForPath(pathFromPageName(name)) };
    }
  }
  return { name: ORG_CONFIG_PAGE, text: "", syntax: "org" };
}

async function readDefaultConfigTemplate(syntax: PageSyntax): Promise<string> {
  const template = await asset.readAsset(
    PLUG_NAME,
    syntax === "org" ? "assets/CONFIG.org" : "assets/CONFIG.md",
  );
  return template.replaceAll("{{MANAGED_MARKER}}", MANAGED_MARKER);
}

export async function openConfiguration() {
  await openPanel("configuration");
}

export async function openShortcuts() {
  await openPanel("shortcuts");
}

export async function openLibraries() {
  await openPanel("libraries");
}

// Each of these opens the Libraries tab with a focus hint, which the tab
// dispatches on to run the matching action or pop the matching form -- so
// `Library: Install` lands on the install prompt rather than making the user
// find it. There is no command for the "manager" hint: it is what the tab
// does with no hint at all, so `Library: Manager` covered it twice.
export async function openLibrariesInstall() {
  await openPanel("libraries", "install");
}
export async function openLibrariesAddRepo() {
  await openPanel("libraries", "addRepository");
}
export async function openLibrariesUpdateAll() {
  await openPanel("libraries", "updateAll");
}
export async function openLibrariesUpdateAllRepos() {
  await openPanel("libraries", "updateAllRepositories");
}

async function openPanel(initialTab: TabId, librariesFocus?: LibrariesFocus) {
  const [schemas, values, categories, commands, configPage, libraries] =
    await Promise.all([
      config.getSchemas(),
      config.getValues(),
      config.getCategories(),
      system.listCommands(),
      resolveConfigPage(),
      listLibraries(),
    ]);

  let configOverrides: Record<string, any> = {};
  let commandOverrides: Record<string, CommandOverride> = {};
  const block = findManagedBlock(configPage.text);
  if (block) {
    const parsed = parseManagedBlock(block.innerContent);
    configOverrides = parsed.configOverrides;
    commandOverrides = parsed.commandOverrides;
  }

  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent || "");

  const { html, script } = await buildConfigurationHtml({
    schemas,
    values,
    categories,
    commands,
    commandOverrides,
    configOverrides,
    isMac,
    initialTab,
    libraries,
    librariesFocus,
  });
  await editor.showPanel("modal", 100, html, script);
}

export async function saveConfiguration(
  pendingConfig: Record<string, any>,
  pendingShortcuts: Record<string, CommandOverride>,
) {
  const lines: string[] = [MANAGED_MARKER];

  for (const [path, value] of Object.entries(pendingConfig)) {
    if (value === undefined) continue;
    lines.push(`config.set(${toLua(path)}, ${toLua(value)})`);
  }

  for (const [name, override] of Object.entries(pendingShortcuts)) {
    const parts: string[] = [];
    parts.push(`name = ${toLua(name)}`);
    if (override.key !== undefined) {
      parts.push(`key = ${toLua(override.key)}`);
    }
    if (override.mac !== undefined) {
      parts.push(`mac = ${toLua(override.mac)}`);
    }
    lines.push(`command.update { ${parts.join(", ")} }`);
  }

  const blockContent = lines.join("\n");

  const configPage = await resolveConfigPage();
  const configText =
    configPage.text || (await readDefaultConfigTemplate(configPage.syntax));

  const hasContent =
    Object.keys(pendingConfig).length > 0 ||
    Object.keys(pendingShortcuts).length > 0;

  const newText = replaceManagedBlock(
    configText,
    hasContent ? blockContent : "",
    configPage.syntax,
  );

  await space.writePage(configPage.name, newText);

  // The file behind the page, which is `CONFIG.md` for the bare name and
  // `CONFIG.org` for the Org page -- not the page name with `.md` stuck on.
  const configPath = pathFromPageName(configPage.name);
  await sync.performFileSync(configPath);
  await mq.send("indexQueue", configPath);
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
  await editor.rebuildEditorState();
}

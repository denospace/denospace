---
description: Defines the schemas and built-in values of built-in configuration options
tags: meta
---

SilverBullet uses the [config APIs](https://silverbullet.md/API/config) to manage its runtime configuration. You can set most of these anywhere in your space, but the convention is to use your `CONFIG` page for this purpose.

This meta page defines the JSON Schema of all built-in configuration settings, as well as their default values. You can override them by e.g. putting the following in your CONFIG page (use `space-lua` instead of `lua` in your actual page):

```lua
config.set("sync.documents", true)
```

# Built-in options (schema)

This defines the [JSON schema](https://json-schema.org/) for built-in configuration.

```space-lua
-- priority: 100

-- UI categories for the configuration manager, listed in display order.
-- The library itself comes first: it is what this fork is for, and these are
-- the settings a Denote user arrives already knowing the names of.
config.defineCategory {
  name = "Denote",
  description = "How notes are created and named: which questions you are asked, the file format, and whether a rename follows an edited front matter.",
  priority = 60,
}
config.defineCategory {
  name = "Journal",
  description = "Where journal entries live, what keyword marks them, and how their titles are written.",
  priority = 55,
}
config.defineCategory {
  name = "Editor",
  description = "Behavior of the page editor: brackets, wiki link rendering, emoji aliases, and similar editing affordances.",
  priority = 50,
}
config.defineCategory {
  name = "Smart Quotes",
  description = "Replace straight quotes with typographic ones as you type, and pick which characters are used.",
  priority = 40,
}
config.defineCategory {
  name = "Sync",
  description = "Control how this client synchronizes pages and documents with the server.",
  priority = 30,
}
config.defineCategory {
  name = "Indexing",
  description = "Choose which kinds of content (paragraphs, items, tasks) are indexed for queries.",
  priority = 20,
}
config.defineCategory {
  name = "Query",
  description = "Configure how queries collate and compare strings, including locale-aware sorting.",
  priority = 10,
}

config.define("sync", {
  description = "Configure sync",
  type = "object",
  properties = {
    documents = {
      type = "boolean",
      default = false,
      description = "Sync document files (non-markdown) locally from the server. Allows access to document files while offline.",
      ui = { category = "Sync", label = "Sync documents", priority = 1 },
    },
    -- In .gitignore format, either in a single string, or as a list of strings
    ignore = {
      oneOf = {
        schema.array "string",
        schema.string()
      }
    }
  },
  additionalProperties = false
})

config.define("index", {
  description = "Configure individual indexers",
  type = "object",
  properties = {
    paragraph = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          -- On in this fork: unlinked mentions are found by searching them.
          default = true,
          description = "Index paragraphs without a hashtag",
          ui = { category = "Indexing", label = "Index all paragraphs", priority = 3 },
        },
      },
    },
    item = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          default = true,
          description = "Index items without a hashtag",
          ui = { category = "Indexing", label = "Index all items", priority = 2 },
        },
      },
    },
    task = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          default = true,
          description = "Index tasks without a hashtag",
          ui = { category = "Indexing", label = "Index all tasks", priority = 1 },
        },
      },
    },
  },
  additionalProperties = true
})

-- Editor configuration options
config.define("autoCloseBrackets", {
  description = "List of opening bracket characters to auto-close",
  type = "string",
  default = "([{",
})

config.define("shortWikiLinks", {
  description = "Render wiki links to just the last segment, e.g. Person/John becomes John",
  type = "boolean",
  default = true,
  ui = { category = "Editor", label = "Short wiki links", priority = 1 },
})

config.define("linkWriteFormat", {
  description = "How SilverBullet writes wiki links it generates: 'shortest' uses the bare page name when that name is unique in the space and the full path when it is not, 'shortest-suffix' writes the shortest path suffix that still uniquely identifies the page instead of the full path, 'full-path' always writes the full path",
  type = "string",
  enum = { "shortest", "shortest-suffix", "full-path" },
  default = "full-path",
  ui = { category = "Editor", label = "Link write format", priority = 2 },
})

config.define("frontmatterFolding", {
  description = "Configure folding behavior for YAML frontmatter at the top of pages",
  type = "object",
  properties = {
    foldByDefault = {
      type = "string",
      enum = { "never", "long", "always" },
      default = "long",
      description = "When to automatically fold frontmatter when opening a page",
      ui = { category = "Editor", label = "Auto-fold frontmatter", priority = 0 },
    },
    foldByDefaultLines = {
      type = "number",
      default = 5,
      minimum = 1,
      multipleOf = 1,
      description = "Fold frontmatter automatically when it has more than this positive whole number of lines and auto-fold is set to long",
      ui = { category = "Editor", label = "Frontmatter auto-fold lines", priority = -2 },
    },
  },
  additionalProperties = false,
})

config.define("emoji", {
  description = "Additional emoji aliases",
  type = "object",
  properties = {
    aliases = {
      type = "object",
      additionalProperties = schema.string(),
    }
  }
})

config.define("smartQuotes", {
  description = "Configure smart quotes",
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      description = "Indicates whether smart quotes are enabled",
      ui = { category = "Smart Quotes", label = "Enable smart quotes", priority = 5 },
      default = true,
    },
    double = {
      type = "object",
      properties = {
        left = {
          type = "string",
          default = "“",
          description = "Character for the left double quote",
          ui = { category = "Smart Quotes", label = "Double quote left", priority = 4 },
        },
        right = {
          type = "string",
          default = "”",
          description = "Character for the right double quote",
          ui = { category = "Smart Quotes", label = "Double quote right", priority = 3 },
        }
      },
      additionalProperties = false
    },
    single = {
      type = "object",
      properties = {
        left = {
          type = "string",
          default = "‘",
          description = "Character for the left single quote",
          ui = { category = "Smart Quotes", label = "Single quote left", priority = 2 },
        },
        right = {
          type = "string",
          default = "’",
          description = "Character for the right single quote",
          ui = { category = "Smart Quotes", label = "Single quote right", priority = 1 },
        }
      },
      additionalProperties = false
    },
  },
  additionalProperties = false
})

config.define("mobileMenuStyle", {
  type = "string",
})

config.define("vim", {
  description = "Vim mode configuration",
  type = "object",
  properties = {
    unmap = {
      description = "Keys to unmap",
      type = "array",
      items = {
        oneOf = {
          { type = "string" },
          {
            type = "object",
            properties = {
              key = { type = "string" },
              mode = {
                type = "string",
                enum = {"normal", "insert", "visual", "operator"}
              }
            },
            required = { "key" },
            additionalProperties = false
          }
        }
      }
    },
    map = {
      description = "Custom mappings",
      type = "array",
      items = {
        type = "object",
        properties = {
          map = { type = "string" },
          to = { type = "string" },
          mode = {
            type = "string",
            enum = {"normal", "insert", "visual", "operator"}
          }
        },
        required = { "map", "to" },
        additionalProperties = false
      }
    },
    noremap = {
      description = "Non-recursive custom mappings",
      type = "array",
      items = {
        type = "object",
        properties = {
          map = { type = "string" },
          to = { type = "string" },
          mode = {
            type = "string",
            enum = {"normal", "insert", "visual", "operator"}
          }
        },
        required = { "map", "to" },
        additionalProperties = false
      }
    },
    commands = {
      description = "Custom Ex commands",
      type = "array",
      items = {
        type = "object",
        properties = {
          command = { type = "string" },
          ex = { type = "string" }
        },
        required = { "command", "ex" },
        additionalProperties = false
      }
    },
  },
  additionalProperties = false
})

-- Query specific configuration options
config.define("queryCollation", {
  description = "Configure string ordering in queries",
  type = "object",
  ui = { category = "Query", label = "Query collation", priority = 1 },
  properties = {
    enabled = {
      type = "boolean",
      default = false,
      description = "Indicates whether string collation should be used instead of simple codepoint ordering",
      ui = { category = "Query", label = "Enable collation", priority = 2 },
    },
    locale = {
      type = "string",
      description = "Language tag to specify sorting rules (from BCP 47)",
      ui = { category = "Query", label = "Locale", priority = 1 },
    },
    options = {
      type = "object",
      description = "Additional options passed to Intl.Collator constructor"
      -- See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator/Collator#options
    },
  },
  additionalProperties = false
})

-- Configuration for internal use mostly

-- Don't use directly, use command.define instead
config.define("commands", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      contexts = schema.nullableArray "string",
      priority = schema.nullable "number",
      key = {
        anyOf = {
          schema.string(),
          schema.array("string"),
          schema.null()
        }
      },
      mac = {
        anyOf = {
          schema.string(),
          schema.array("string"),
          schema.null()
        }
      },
      hide = schema.nullable "boolean",
      requireMode = schema.nullable {
        type = "string", 
        enum = {"rw", "ro"},
      },
      requireEditor = schema.nullable("string"),
      run = schema.func(),
    },
  },
})

-- Don't use directly, use slashCommands.define instead
config.define("slashCommands", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      description = schema.nullable "string",
      priority = schema.nullable "number",
      onlyContexts = schema.nullableArray "string",
      exceptContexts = schema.nullableArray "string",
      run = schema.func(),
    },
  },
})

-- Don't use directly, use event.listen instead
config.define("eventHandlers", {
  type = "object",
  additionalProperties = schema.array(schema.func()),
})

-- Don't use directly, use mq.listen instead
config.define("mqSubscriptions", {
  type = "object",
  additionalProperties = {
    type = "array",
    items = {
      type = "object",
      properties = {
        batchSize = schema.number(),
        run = schema.func(),
      }
    }
  },
})

-- Task states
config.define("taskStates", {
  type = "object",
  default = {},
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      done = schema.nullable "boolean",
      order = schema.nullable "number",
    },
    required = {"name"},
  },
})

-- Identities
config.define("identities", {
  type = "object",
  default = {},
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      description = schema.nullable "string",
    },
    required = {"name"},
  },
})

-- Don't use directly, WIP
config.define("tags", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      schema = schema.schema(),
      -- Whether or not an object HAS to validate to be indexed (defaults to false), has a performance penalty
      mustValidate = schema.boolean(),
      -- Additional custom validation logic
      validate = schema.func(),
      -- Invoked by the object indexer, takes a proposed object as input, returns an array of objects (can be empty table to skip indexing altogether)
      transform = schema.func(),
    },
  },
})

-- Don't use directly, use actionButton.define instead
config.define("actionButtons", {
  type = "array",
  items = {
    type = "object",
    properties = {
      icon = {
        type = "string",
        description = "Icon for the action button, from https://feathericons.com"
      },
      description = {
        type = "string",
        description = "Optional description of the action button"
      },
      command = {
        type = "string",
        description = "Optional command name to invoke when clicked (replaces run). The command's keyboard shortcut is automatically shown in the tooltip."
      },
      priority = {
        type = "number",
        description = "Optional priority: the higher the earlier the button will appear in the list"
      },
      mobile = {
        type = "boolean",
        description = "Optional boolean indicating if the action button is applicable for mobile"
      },
      standalone = {
        type = "boolean",
        description = "Optional: when set to true, button only appears in standalone/PWA mode; when false, only in browser mode"
      },
      dropdown = {
        type = "boolean",
        description = "Optional: set to false to keep this button outside the dropdown menu on mobile (default: true)"
      },
      run = schema.func(),
    },
    required = {"icon"},
    additionalProperties = false
  }
})
```

# Default values
Default values that cannot be expressed as schema defaults (e.g. because they contain functions).

```space-lua
-- priority: 99
config.set("actionButtons", {
  {
    icon = "home",
    description = "Go to the index page",
    command = "Navigate: Home",
    priority = 3,
    dropdown = false,
  },
  {
    icon = "book",
    description = "Open page",
    command = "Navigate: Page Picker",
    priority = 2,
    dropdown = false,
  },
  {
    icon = "terminal",
    description = "Run command",
    command = "Open Command Palette",
    priority = 1,
  },
  -- The `#+key:` block is hidden by default, because the top bar already
  -- says what it says. This is the way back to it when the title or the
  -- keywords need changing.
  --
  -- Not on the phone: measured at 390px, a fifth icon takes 32px off a
  -- title that only has 170 to begin with, and front matter is not what
  -- a phone is for. The command palette still has it.
  {
    icon = "info",
    description = "Show or hide this note's metadata",
    command = "Editor: Toggle Metadata",
    mobile = false,
    priority = 0.5,
  },
  -- Today's journal entry, made if it is not there yet. The one page a
  -- journal-keeping library opens more than any other, so it gets a button
  -- rather than a command palette round trip.
  {
    icon = "calendar",
    description = "Today's journal",
    command = "Journal: Today",
    priority = 4,
    dropdown = false,
  },
  -- Phone first: `capture` opens the camera, and a photo belongs in the note.
  {
    icon = "camera",
    description = "Take a photo into this note",
    command = "Upload: Take Photo",
    mobile = true,
    priority = -2,
  },
  {
    icon = "crop",
    description = "Scan a document into this note",
    command = "Upload: Scan Document",
    mobile = true,
    priority = -3,
  },
  {
    icon = "chevron-left",
    description = "Go back",
    standalone = true,
    priority = 0,
    run = function()
      editor.goHistory(-1)
    end,
  },
  {
    icon = "chevron-right",
    description = "Go forward",
    standalone = true,
    priority = -1,
    run = function()
      editor.goHistory(1)
    end,
  }
})

-- Every `denote.*` key, so the configuration manager can show them and a typo
-- in a CONFIG page is reported rather than silently read as a default. The
-- defaults here are the same ones the code falls back to; `denote-journal`'s
-- are Denote's own.
config.define("denote", {
  description = "Denote: note creation, naming and the journal",
  type = "object",
  properties = {
    prompts = {
      type = "array",
      items = {
        type = "string",
        enum = {
          "title",
          "keywords",
          "signature",
          "date",
          "file-type",
          "subdirectory",
          "template",
        },
      },
      default = { "title", "keywords" },
      description = "`denote-prompts`: which questions creating a note asks, and in what order. Every creation command runs this list plus the one prompt it exists for, so `Note: New with Signature` is this list with `signature` appended.",
      ui = { category = "Denote", label = "Creation prompts", priority = 6 },
    },
    fileType = {
      type = "string",
      -- Denote's fourth type, `text`, is missing on purpose: it writes
      -- `.txt`, which here is a document rather than a page.
      enum = { "org", "markdown-yaml", "markdown-toml" },
      default = "org",
      description = "`denote-file-type`: the format new notes are written in. `Note: New of Type` overrides it for one note.",
      ui = { category = "Denote", label = "File type", priority = 5 },
    },
    renameOnSave = {
      type = "boolean",
      default = true,
      description = "Rename a note's file when its front matter changes, so the name never disagrees with the title, keywords or signature inside it.",
      ui = { category = "Denote", label = "Rename on save", priority = 4 },
    },
    updateDblocksOnSave = {
      type = "boolean",
      default = true,
      description = "Regenerate dynamic blocks when a note is saved.",
      ui = { category = "Denote", label = "Update dynamic blocks on save", priority = 3 },
    },
    updateDblocksOnOpen = {
      type = "boolean",
      default = true,
      description = "Regenerate dynamic blocks when a note is opened.",
      ui = { category = "Denote", label = "Update dynamic blocks on open", priority = 2 },
    },
    journalDirectory = {
      type = "string",
      default = "journal",
      description = "`denote-journal-directory`: the one directory a flat library keeps, holding the dated entries.",
      ui = { category = "Journal", label = "Journal directory", priority = 3 },
    },
    journalKeyword = {
      type = "string",
      default = "journal",
      description = "`denote-journal-keyword`: the keyword that marks an entry as a journal entry. It is what the journal views and `Journal: Open Date` look for, not the directory alone.",
      ui = { category = "Journal", label = "Journal keyword", priority = 2 },
    },
    journalTitleFormat = {
      type = "string",
      -- Not an enum: `denote-journal-title-format` also takes a format
      -- string, and anything unrecognised is used as one.
      default = "day-date-month-year-24h",
      description = "`denote-journal-title-format`: `day`, `day-date-month-year`, `day-date-month-year-24h` or `day-date-month-year-12h`. Anything else is used as a time format string directly.",
      ui = { category = "Journal", label = "Journal title format", priority = 1 },
    },
  },
  additionalProperties = false,
})
```

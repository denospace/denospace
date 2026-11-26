Full-text search across every note, in the shape `denote-grep` and
`consult-denote-grep` have in Emacs: type, see matching **lines** from the
whole library narrowing as you go, press Return to land on the line itself.

Bound to `Alt-/`. `Cmd-/` is Open Command Palette in this fork; see the README
if you would rather swap them.

Denote has two ways into the same search, and so does this. Opened as a modal
it is `consult-denote-grep`: a picker that closes on the match you take.
**Docked** left or right — from the panel's own dock menu — it is
`denote-grep`'s query buffer: it stays open while you walk the matches one
after another, which is the whole point of a grep over a page picker.

# Narrowing a search
Denote's query buffer does not just list matches, it lets you cut the list
down: `denote-query-exclude-files` and friends. The same commands here:

| Command | Emacs |
|---|---|
| `Search: Exclude Files` — drop notes whose **name** contains the text | `denote-query-exclude-files` |
| `Search: Only Include Files` — keep only those | `denote-query-only-include-files` |
| `Search: Exclude Keyword` | `denote-query-exclude-files-with-keywords` |
| `Search: Only Keyword` | `denote-query-only-include-files-with-keywords` |
| `Search: Clear Filters` | `denote-query-clear-all-filters` |

Filters are part of the search you are running, not a setting: they live as
long as the panel does and start empty next time, exactly as Denote's are
buffer-local. While any are active the panel shows them in a row at the top,
and taking that row clears them.

```space-lua
-- priority: 10

search = search or {}

-- Below this, a phrase matches so much that the list is noise and the query
-- is expensive for nothing. `consult-async-min-input` is 3 for the same
-- reason.
search.minPhrase = 3

-- Enough to scroll, few enough to stay responsive. A phrase that needs more
-- than this wants narrowing, not paging -- which is what the filters below
-- are for.
search.maxHits = 200

-- Every object that carries a line of a note: prose, list items, tasks and
-- headings. Four tags rather than one because the indexer splits a page by
-- what each piece *is* -- there is no single "text" object to ask.
search.textTags = { "paragraph", "item", "task", "header" }

-- Denote's query filters are buffer-local: they belong to the search in front
-- of you and are gone when it is. These are the same, deliberately -- a filter
-- is not a preference, and one left behind from an hour ago silently hiding
-- results is the failure mode worth avoiding.
search.filters = {
  excludeName = {},
  onlyName = {},
  excludeKeyword = {},
  onlyKeyword = {},
}

-- What the last search was for, so a filter command can re-run it.
search.lastPhrase = ""

-- Matching is plain and case-insensitive: `string.find` with `plain` set, so
-- a phrase with a `-` or a `.` in it searches for those characters instead of
-- being read as a pattern. Nobody types `%s+` into a search box by accident,
-- and everybody types hyphens.
function search.matches(text, needle)
  if not text then return false end
  return string.find(string.lower(text), needle, 1, true) ~= nil
end

-- page -> { title, keywords }. Two things need this: a hit reads better
-- labelled with the note's title than its file name (a Denote name is a slug
-- of the title with the identifier and keywords attached), and the keyword
-- filters need something to filter on.
function search.notes()
  local byPage = {}
  for _, o in ipairs(query [[ from o = index.objects("denote") ]]) do
    byPage[o.page] = { title = o.title, keywords = o.keywords or {} }
  end
  return byPage
end

function search.anyFilter()
  local f = search.filters
  return #f.excludeName > 0 or #f.onlyName > 0
    or #f.excludeKeyword > 0 or #f.onlyKeyword > 0
end

local function containsText(haystack, needle)
  return string.find(string.lower(haystack or ""), string.lower(needle), 1, true) ~= nil
end

local function hasKeyword(keywords, wanted)
  for _, k in ipairs(keywords or {}) do
    if k == wanted then return true end
  end
  return false
end

-- Whether a page survives the active filters. `only*` lists are "keep only
-- what matches any of these"; `exclude*` lists are "drop anything matching
-- any of these". Both directions, because Denote has both, and narrowing by
-- what you want and by what you don't are different moves.
function search.allowed(page)
  local f = search.filters
  local note = (search._notes or {})[page] or {}

  for _, pattern in ipairs(f.excludeName) do
    if containsText(page, pattern) then return false end
  end
  if #f.onlyName > 0 then
    local kept = false
    for _, pattern in ipairs(f.onlyName) do
      if containsText(page, pattern) then kept = true end
    end
    if not kept then return false end
  end

  for _, keyword in ipairs(f.excludeKeyword) do
    if hasKeyword(note.keywords, keyword) then return false end
  end
  if #f.onlyKeyword > 0 then
    local kept = false
    for _, keyword in ipairs(f.onlyKeyword) do
      if hasKeyword(note.keywords, keyword) then kept = true end
    end
    if not kept then return false end
  end

  return true
end

-- One line of a note, as a row: what matched, and which note it was in.
function search.hits(phrase)
  local needle = string.lower(phrase)
  -- Read once per search rather than once per hit, and stashed where
  -- `search.allowed` can reach it from inside the query's `where`.
  search._notes = search.notes()
  local hits = {}
  for _, tag in ipairs(search.textTags) do
    local remaining = search.maxHits - #hits
    if remaining <= 0 then
      return hits
    end
    -- The filter goes in the query so the limit is applied where the scan is,
    -- rather than after everything has been handed over. The page filters go
    -- in with it, so a narrowed search returns a full page of results it is
    -- allowed to show instead of a page it then throws most of away.
    local found = query [[
      from o = index.objects(tag)
      where search.matches(o.text or o.name, needle) and search.allowed(o.page)
      limit remaining
    ]]
    for _, obj in ipairs(found) do
      local note = search._notes[obj.page]
      table.insert(hits, {
        ref = obj.ref,
        page = obj.page,
        label = (note and note.title) or obj.page,
        text = string.trim(obj.text or obj.name or ""),
        tag = tag,
      })
    end
  end
  return hits
end

-- The row that says what is being hidden, and clears it when taken. Only
-- present while something is filtered, so it costs nothing the rest of the
-- time.
function search.filterRow()
  local f = search.filters
  local parts = {}
  for _, p in ipairs(f.onlyName) do table.insert(parts, "name " .. p) end
  for _, p in ipairs(f.excludeName) do table.insert(parts, "not name " .. p) end
  for _, k in ipairs(f.onlyKeyword) do table.insert(parts, "keyword " .. k) end
  for _, k in ipairs(f.excludeKeyword) do table.insert(parts, "not keyword " .. k) end
  return {
    isFilterRow = true,
    label = "Filtered: " .. table.concat(parts, ", "),
    text = "Filtered: " .. table.concat(parts, ", "),
    page = "",
    tag = "filter",
  }
end

view.define {
  name = "std.searchNotes",
  title = "Search Notes",
  command = "Navigate: Search Notes",
  key = "Alt-/",
  mac = "Alt-/",
  menu = { location = "file", group = "3_palette", label = "Search Notes..." },
  -- Modal by default, so `Alt-/` is still the quick `consult-denote-grep`
  -- picker. Docked it stops closing on the match you take -- that is the
  -- difference between a picker and `denote-grep`'s query buffer, and it is
  -- the panel's own dock menu that switches between them.
  dock = "modal",
  supportedDocks = { "modal", "lhs", "rhs" },
  -- The source is re-run with what has been typed, rather than the rows being
  -- filtered client-side: the library is far too big to hand over in full,
  -- and this is the whole reason the mode exists.
  search = "source",
  placeholder = "Search every note...",
  -- `openNavigator` on a panel that is already on screen does not re-run its
  -- source, so a filter command cannot refresh the results by re-opening the
  -- view -- it dispatches `search:filtersChanged` and this brings the rows
  -- back round. The file events are for the docked case: a buffer that stays
  -- open while you edit should not be showing lines that have since changed.
  refreshOn = {
    "search:filtersChanged",
    "file:changed",
    "file:deleted",
    "mq:emptyQueue:indexQueue",
  },
  source = function(ctx)
    local phrase = string.trim(ctx.phrase or "")
    search.lastPhrase = phrase
    if #phrase < search.minPhrase then
      return {}
    end
    local rows = search.hits(phrase)
    if search.anyFilter() then
      table.insert(rows, 1, search.filterRow())
    end
    return rows
  end,
  presentation = {
    row = {
      -- The matching line is what you are reading; the note is context for
      -- it. That way round because a page name is often a date.
      primary = function(obj) return obj.text end,
      description = function(obj) return obj.label or obj.page end,
      icon = function(obj)
        if obj.isFilterRow then return "filter" end
        if obj.tag == "header" then return "hash" end
        if obj.tag == "task" then return "check-square" end
        return "align-left"
      end,
    },
  },
  -- `page@pos` lands on the line, not the top of the page -- the thing that
  -- makes a grep worth having over a page picker.
  onSelect = function(obj)
    if obj.isFilterRow then
      search.clearFilters()
      return false
    end
    editor.navigate(obj.ref)
  end,
}
```

# The filter commands

```space-lua
-- priority: -1

-- Re-runs the search with the filters as they now are.
--
-- The panel listens for this event (`refreshOn`), which is the only thing that
-- makes it re-query: re-opening an already-visible panel with `openNavigator`
-- leaves the rows it has, so a filter command cannot refresh by re-opening.
-- With the panel closed the event falls on nothing, which is right -- the
-- filter is set, and the next search honours it.
function search.rerun()
  event.dispatch("search:filtersChanged", {})
  return false
end

function search.clearFilters()
  search.filters = {
    excludeName = {},
    onlyName = {},
    excludeKeyword = {},
    onlyKeyword = {},
  }
  return search.rerun()
end

-- Every keyword in the library, for the two keyword filters to pick from.
-- Typing one that nothing carries would filter everything away, so this is a
-- picker rather than a free prompt.
local function pickKeyword(label)
  local counts = {}
  for _, note in pairs(search.notes()) do
    for _, k in ipairs(note.keywords or {}) do
      counts[k] = (counts[k] or 0) + 1
    end
  end
  local options = {}
  for keyword, count in pairs(counts) do
    table.insert(options, {
      name = keyword,
      description = count .. (count == 1 and " note" or " notes"),
    })
  end
  table.sort(options, function(a, b) return a.name < b.name end)
  if #options == 0 then
    editor.flashNotification("No note carries a keyword yet")
    return
  end
  local chosen = editor.filterBox(label, options, "Pick a keyword")
  return chosen and chosen.name
end

local function addFilter(list, value)
  if not value or value == "" then return end
  for _, existing in ipairs(list) do
    if existing == value then return search.rerun() end
  end
  table.insert(list, value)
  return search.rerun()
end

command.define {
  name = "Search: Exclude Files",
  run = function()
    return addFilter(
      search.filters.excludeName,
      editor.prompt("Exclude notes whose name contains:", "")
    )
  end,
}

command.define {
  name = "Search: Only Include Files",
  run = function()
    return addFilter(
      search.filters.onlyName,
      editor.prompt("Only notes whose name contains:", "")
    )
  end,
}

command.define {
  name = "Search: Exclude Keyword",
  run = function()
    return addFilter(search.filters.excludeKeyword, pickKeyword("Exclude keyword"))
  end,
}

command.define {
  name = "Search: Only Keyword",
  run = function()
    return addFilter(search.filters.onlyKeyword, pickKeyword("Only keyword"))
  end,
}

command.define {
  name = "Search: Clear Filters",
  run = function()
    return search.clearFilters()
  end,
}
```

---
description: The inline rendering of markup as you type.
tags: glossary
references:
- client/codemirror/clean.ts
- client/markdown_renderer/markdown_render.ts
---
Notes are edited in a “live preview” editor: the markup renders in place as you type rather than being shown and then previewed somewhere else. The mechanism is heavily inspired by [Obsidian's live preview mode](https://obsidian.md/help/edit-and-read#Live+Preview).

It reduces visual noise by not constantly showing the formatting itself — `*bold*`, a `#+TITLE:` keyword, the brackets around a link — only showing it when the cursor is placed inside.

This is not a Markdown feature, even though it arrived as one: the same machinery renders [[Org Mode]] markup, which is what a space is written in, and [[Markdown]] where a `.md` file still turns up.

# Revealing the source
You can always see the underlying format by moving your cursor "inside" any formatted element with the keyboard, or by **Alt-clicking** (or Option-clicking on Mac) on any piece of formatted text.

For links specifically there is ${widgets.commandButton("Note: Toggle Link Display")}, which switches every link in the note between its description and its source without touching the rest of the markup — Org's `org-toggle-link-display`.

# Toggling live preview
If you prefer to see the raw markup at all times, run the ${widgets.commandButton("Editor: Toggle Markup Display")} command. This switches between live preview mode and raw markup mode, and the choice is remembered.

# Widget rendering
[[Space Lua#Expressions]] (`${...}`) are rendered inline as live widgets. The underlying code is hidden until you move your cursor into the expression. This is what makes pages feel dynamic — queries, templates, and widgets all render seamlessly within the document.

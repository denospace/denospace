# Provenance of the Denote sluggification code

## Why this file exists

This fork reads and writes a [Denote](https://protesilaos.com/emacs/denote)
library. Denote's file-naming scheme is a **file format**: a note written by
Emacs and a note written here have to be the same bytes on disk, which means
this code has to produce byte-identical file names.

The reference implementation, `denote.el`, is licensed **GPL-3.0-or-later**
and its copyright is held by the **Free Software Foundation, Inc.** This fork
is MIT (see `LICENSE.md`). A naming scheme is an unprotectable functional
specification and anyone may implement it — but a *translation* of GPL source
into another language is a derivative work of it, and may not be relicensed.

An earlier version of `plug-api/lib/denote.ts` in this repository was written
by reading `denote.el` and was described in its own header as "ported" from
it. Its three punctuation character classes were identical to that source's,
character for character and in the same order, and its helper functions
mirrored the same decomposition in the same sequence. That is a derivative
work, whatever the licence file says. It has been removed, in full, and
replaced by `plug-api/lib/denote_slug.ts`.

## How the replacement was produced

By **black-box observation of the reference tool**, which is ordinary
reverse engineering for interoperability, and a clean-room split between the
party that had seen the original and the party that wrote the code.

1. **Behaviour was recorded, not read.** `tools/denote-slug-oracle/oracle.el`
   calls only Denote's public sluggification entry point and writes down what
   it returns. It inspects none of its implementation. The resulting fixture,
   `tools/denote-slug-oracle/oracle-pairs.tsv`, holds **1,713
   component/input/output triples**, probing every printable ASCII character
   in four positions for all four components, plus unicode, typographic
   quotation marks, separator runs, exotic space characters and empty input.

2. **A specification was written from that fixture**, stating observable
   behaviour only — no algorithm, no helper decomposition, no character sets
   transcribed. The character classes were deliberately *left out* of the
   prose so that they had to be derived from the recorded data.

3. **The implementation was written by a party that had not seen
   `denote.el`**, from that specification and fixture alone, in an isolated
   directory containing no other implementation, with instructions not to
   consult one or to reproduce one from memory. It chose its own
   decomposition: a tokeniser over character sets, rather than the reference's
   sequential regular-expression pipeline. Its own account is below.

4. **It was validated against reality**: 4,378 `(title, filename)` pairs
   harvested from a real 4,000-note library built with the reference tool over
   several years. 4,369 reproduce exactly. The nine exclusions are named in
   `plug-api/lib/denote_slug.test.ts` and are output of *older versions* of the
   reference tool, whose rules for the apostrophe and for non-plain spaces
   have since changed; no single implementation can satisfy both them and
   current behaviour. That corpus is personal content and is deliberately
   **not** in this repository.

The replacement is also *more* faithful than what it replaced: the ported code
diverged from the reference tool in 38 of the 1,713 recorded cases — it
stripped backslashes the reference keeps, treated tabs and no-break spaces as
word separators when the reference treats only `U+0020` as one, and mishandled
brackets and query markers in identifiers.

## Rule for future changes

**Do not read `denote.el` to change this code.** To change behaviour, re-probe
the reference tool with `tools/denote-slug-oracle/oracle.el`, update
`oracle-pairs.tsv`, and make the test pass. The fixture is the specification.

## Statement of the implementing party

> (verbatim, as written on completion)
> 
> ## What I had
> 
> Only what is in this directory: `SPEC.md`, `slug.test.ts`, and the two
> fixture files — `fixtures/oracle-pairs.tsv` (1,713 recorded
> component/input/output triples) and `fixtures/real-titles.json` (4,378
> `{raw, slug}` pairs from a real library). Nothing else was read or searched.
> 
> ## How the rules were derived
> 
> `oracle-pairs.tsv` probes every printable ASCII character in four positions
> for all four components, so the character classes fall straight out of it. I
> read it in full, then grouped the characters by what the three text components
> do with them:
> 
> * a character that survives in all positions is **kept** — this includes `<`,
>   `>` and `\`, which I would otherwise have assumed were stripped;
> * a character that vanishes from the middle of `a<c>b` is **discarded**;
> * a character that turns into the component's joining mark in `a<c>b` is a
>   **word separator**.
> 
> That split showed the per-component asymmetry directly: `_` and the plain
> space break a word for every component, each component also breaks on its own
> joining mark (`-` for `title`, `=` for `signature`), and the other delimiters
> are simply deleted — so `=` and `@` disappear from a title while `-` and `@`
> disappear from a signature. For `keyword` the joining mark is the empty
> string, which is why its words run together. The run-collapsing, leading- and
> trailing-separator behaviour I did not implement as a separate pass; it is a
> consequence of splitting into words and rejoining, which the doubled- and
> mixed-delimiter rows of the fixture confirm.
> 
> The whitespace and `identifier` rules I derived by hex-dumping the relevant
> fixture rows rather than trusting how they render: tab, `U+00A0` and `U+200B`
> all come back untouched, so only the plain space separates words. The
> `identifier` rows show it is neither lowercased
> nor respaced, keeps nearly all punctuation, drops only `.()[]` and the two
> `query-…:` markers, squeezes a doubled delimiter back to one, and trims
> trailing delimiters while keeping leading ones.
> 
> Non-ASCII handling came from the tail of the oracle file and was cross-checked
> against every non-ASCII character actually present in `real-titles.json`: the
> four typographic quotation marks are discarded, and everything else there —
> accents, dashes of both widths, `…`, `®`, `↔`, `＃`, emoji, Greek, Cyrillic,
> CJK — is kept.
> 
> The two fixture sources at first appeared to disagree on `U+00A0`: the oracle
> kept it, while five library names had it (and `U+202F`) hyphenated. That was
> settled by **further recorded behaviour of the reference tool, supplied to me
> as additional black-box observations** — including a probe of `x y z`,
> which hyphenates at the plain space while keeping the no-break space, and a
> re-probe of the exact library title in question. Those five names are older
> output and the harness now excludes them, so the rule is unconditional: the
> plain space is the only word separator. No implementation was consulted to
> resolve it.
> 
> ## Confirmation
> 
> I consulted no implementation of this behaviour: no Emacs Lisp, no `denote`
> source, no JavaScript or TypeScript port, no write-up of one's internals, and
> no web search. I read nothing outside this directory. The decomposition,
> names and order of operations are my own, written to fit the recorded data.

# LaTeX Suite in the formula editor

The functions of [Obsidian LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite)
(MIT), built into the active mode's formula dialog. The default snippets,
the snippet variables and the macro list are the plugin's own, unchanged
(`active/latex-snippets.js`, generated from its sources, with its licence);
the machinery is written anew for the dialog's editor (`active/latexsuite.js`).

## Keys

| Key | Does |
|---|---|
| a character | automatic snippets: `sr` → `^{2}`, `@a` → `\alpha`, `dint` → an integral … |
| a character, text selected | visual snippets: `U` `\underbrace`, `O` `\overbrace`, `B` `\underset`, `C` `\cancel`, `K` `\cancelto`, `S` `\sqrt`, `(` `[` `{` around it |
| `/` | auto-fraction: what stands before it becomes the numerator; with a selection, the selection |
| Tab | a snippet that waits for Tab (`par`, `\sum`, `\int`) · the next tabstop · in a matrix: out of a bracket, else ` & ` · behind the next closing bracket · at the end: out of the formula |
| Shift+Tab | the tabstop before |
| Enter | in a matrix, cases, align …: ` \\` and a new line |
| Shift+Enter | in a matrix: to the end of the next line (behind `\end{…}`) |

In the text of the note: `mk` starts a formula in the line, `dm` one on its
own lines (both typed as words of their own). Tab at the end of a formula
closes the dialog; the caret stands behind the formula, or in the line
below a block.

Also: brackets around a sum, an integral or a fraction become
`\left … \right`; bracket pairs are coloured by depth; the brackets the
caret stands in are marked; the places still to fill in are marked; a
button boxes the formula (`\boxed{…}`).

## Settings

Active Mode Settings → Formulas: snippets, fraction, matrix keys, tabout,
growing brackets, bracket colours, `mk` / `dm` — each on its own.

Snippets of one's own: `~/.config/mdview/snippets.js`, in the plugin's
format (`export default [ … ]`, or just the array). As in the plugin, the
file takes the place of the built-in snippets, and it is JavaScript that
runs in the page — only put there what you trust. Read when a window opens.

## Different from the plugin

- `mk` needs a word boundary before it (the plugin expands it anywhere;
  "mk" stands inside many German words).
- Snippets are matched against the formula with its dollars in front, as
  in a note, so `sin` at the very start becomes `\sin`.
- Tabstops with the same number are kept the same as one types (the plugin
  uses several cursors).

## Not built

- Conceal, and the preview popup for inline formulas: the dialog shows the
  rendered formula above the source at all times.
- Snippets outside formulas other than `mk` and `dm` (text, code and inline
  code modes), `triggerKey`, replacements built from nodes, the snippet
  variables file, Vim.
- The source editor mode is unchanged.

## Tests

- `dev/tests/latexsuite.test.mjs`: the machinery against the examples of
  the plugin's README and documentation (13 tests).
- `dev/rig.sh latex`: a formula in the line and a block, typed with real
  keys — `mk`, `dm`, snippets, tabstops, fraction, matrix keys, tabout.

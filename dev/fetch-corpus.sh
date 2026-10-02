#!/bin/bash
# Downloads the external test corpus into dev/corpus/ (not committed): the
# CommonMark and GFM spec examples and READMEs / docs of well-known projects.
# The round-trip tests use it when it is there; `npm test` runs without it too.
set -u
cd "$(dirname "$0")" && mkdir -p corpus/docs && cd corpus
get() { curl -fsSL --max-time 40 "$2" -o "$1" || { echo "skipped: $2" >&2; rm -f "$1"; }; }

get commonmark.json https://spec.commonmark.org/0.31.2/spec.json
get gfm-spec.txt https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt
get gfm-extensions.txt https://raw.githubusercontent.com/github/cmark-gfm/master/test/extensions.txt

raw=https://raw.githubusercontent.com
while read -r name path; do
  [[ -z $name || $name == \#* ]] && continue
  get "docs/$name.md" "$raw/$path"
done <<'LIST'
react            facebook/react/HEAD/README.md
vscode           microsoft/vscode/HEAD/README.md
rust             rust-lang/rust/HEAD/README.md
go               golang/go/HEAD/README.md
node             nodejs/node/HEAD/README.md
node-building    nodejs/node/HEAD/BUILDING.md
vue              vuejs/core/HEAD/README.md
svelte           sveltejs/svelte/HEAD/README.md
deno             denoland/deno/HEAD/README.md
neovim           neovim/neovim/HEAD/README.md
hyprland         hyprwm/Hyprland/HEAD/README.md
markdown-it      markdown-it/markdown-it/HEAD/README.md
katex            KaTeX/KaTeX/HEAD/README.md
katex-supported  KaTeX/KaTeX/HEAD/docs/supported.md
katex-functions  KaTeX/KaTeX/HEAD/docs/support_table.md
mermaid          mermaid-js/mermaid/HEAD/README.md
mermaid-flow     mermaid-js/mermaid/HEAD/docs/syntax/flowchart.md
prosemirror      ProseMirror/prosemirror/HEAD/README.md
pandoc           jgm/pandoc/HEAD/README.md
pandoc-manual    jgm/pandoc/HEAD/MANUAL.txt
commonmark-spec  commonmark/commonmark-spec/HEAD/spec.txt
tldr             tldr-pages/tldr/HEAD/README.md
awesome          sindresorhus/awesome/HEAD/readme.md
ohmyzsh          ohmyzsh/ohmyzsh/HEAD/README.md
tailwind         tailwindlabs/tailwindcss/HEAD/README.md
kubernetes       kubernetes/kubernetes/HEAD/README.md
tensorflow       tensorflow/tensorflow/HEAD/README.md
pytorch          pytorch/pytorch/HEAD/README.md
electron         electron/electron/HEAD/README.md
gh-math          github/docs/HEAD/content/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions.md
gh-basic         github/docs/HEAD/content/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax.md
obsidian-format  obsidianmd/obsidian-help/HEAD/en/Editing%20and%20formatting/Basic%20formatting%20syntax.md
obsidian-callout obsidianmd/obsidian-help/HEAD/en/Editing%20and%20formatting/Callouts.md
obsidian-adv     obsidianmd/obsidian-help/HEAD/en/Editing%20and%20formatting/Advanced%20formatting%20syntax.md
obsidian-flavor  obsidianmd/obsidian-help/HEAD/en/Editing%20and%20formatting/Obsidian%20Flavored%20Markdown.md
ml-notes         dair-ai/ML-Papers-Explained/HEAD/README.md
physics-notes    jakevdp/PythonDataScienceHandbook/HEAD/README.md
LIST
ls docs | wc -l

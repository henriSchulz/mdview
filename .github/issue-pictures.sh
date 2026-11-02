#!/bin/bash
# The pictures an issue shows — a screenshot dropped into its text or a comment, a link to one on
# snipboard.io or the like — fetched into .issue-pictures/ before Claude starts (claude.yml), for
# it to look at with Read. Claude itself cannot fetch them: it may not run curl, since the text it
# reads is written by anyone and could tell it where to send what it has.
#
#   .github/issue-pictures.sh NUMBER     (GH_TOKEN and GITHUB_REPOSITORY set, as in a workflow)
#
# At most 12 pictures of at most 10 MB each; what is no picture once fetched is dropped.
set -u
n=$1 dir=.issue-pictures
mkdir -p "$dir"
{
  gh api "repos/$GITHUB_REPOSITORY/issues/$n" --jq .body
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$n/comments" --jq '.[].body'
} 2>/dev/null |
  grep -oE 'https://(github\.com/user-attachments/assets/[A-Za-z0-9-]+|private-user-images\.githubusercontent\.com/[^ )"<>]+|user-images\.githubusercontent\.com/[^ )"<>]+|[A-Za-z0-9.-]+/[^ )"<>]+\.(png|jpe?g|gif|webp))' |
  awk '!seen[$0]++' | head -12 |
  while read -r url; do
    i=$((${i:-0} + 1)) f="$dir/$(printf %02d "$i")"
    curl -sfL --max-time 30 --max-filesize 10000000 -o "$f" "$url" || { rm -f "$f"; continue; }
    case "$(file -b --mime-type "$f")" in
      image/png) ext=png ;; image/jpeg) ext=jpg ;; image/gif) ext=gif ;; image/webp) ext=webp ;;
      *) rm -f "$f"; continue ;;
    esac
    mv "$f" "$f.$ext" && echo "$(basename "$f.$ext") $url" >> "$dir/sources.txt"
  done
ls "$dir"

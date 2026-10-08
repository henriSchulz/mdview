// The seam between the page (viewer.js and friends, the desktop app's own, unchanged) and whatever
// hosts it. The page says things with MdHost.post(JSON) and is told things by MdView.…(…). The
// desktop's host is the Rust shell (src-tauri/src/shell.rs); the web's will be host.ts, against
// GitHub. This is the whole list, as of the checkout it stands in, and what the web host does
// with each — so that nothing is missing without having been decided. One thing is no message:
// files dropped on a note are handed over as they are, MdHost.drop(files, path), where a host
// has that (the web's; the desktop's is told their addresses, dropfiles).
//
//   answer   the web host does what the shell does, against the repository
//   write    as answer, but it changes the repository: refused while the web app only reads
//   local    done in the browser alone (the clipboard, a new tab, printing)
//   none     has no meaning in a browser, or was decided against; ignored

export type Does = "answer" | "write" | "local" | "none";

/** What the page says: MdHost.post({ type, … }). */
export const FROM_PAGE: Record<string, [Does, string]> = {
  // moving about
  link: ["answer", "a link was clicked: a note of the repository, a place in it, or an address elsewhere"],
  wikilink: ["answer", "a [[wikilink]] was clicked"],
  note: ["answer", "a note was chosen in the sidebar or among the tiles"],
  tab: ["answer", "tabs: new, select, close, move, reopen"],
  back: ["answer", "the note shown before"],
  forward: ["answer", "… and after"],
  resolve: ["answer", "where a link in a field being edited leads (the link popover)"],
  reload: ["answer", "the note read anew"],
  open: ["answer", "another note or repository: back to the list of repositories"],
  folder: ["answer", "as open"],
  close: ["answer", "the window's close: the tab, in a browser"],
  closehold: ["answer", "the closing waits for a question the page is asking"],
  pdfnote: ["answer", "from a highlight in a PDF to the note it is linked from"],
  pdfdata: ["answer", "a PDF's bytes, in pieces"],
  previews: ["answer", "the beginnings of notes, for their tiles"],
  // what the user set
  mode: ["answer", "the mode last used (kept in the browser)"],
  prefs: ["answer", "settings changed (kept in the browser)"],
  sidebar: ["answer", "the sidebar's width, whether it shows, names or titles (kept in the browser)"],
  "settings-info": ["answer", "what the settings show that only the host knows"],
  help: ["answer", "the guide: docs/FEATURES.md, as a note"],
  // writing
  save: ["write", "the note's text"],
  toggle: ["write", "a task ticked in the reading view"],
  newnote: ["write", "a note made"],
  quicknote: ["none", "a quick note made at once (the desktop app's window of quick notes: mdview --quick)"],
  newfolder: ["write", "a folder made (it exists once a note is in it)"],
  rename: ["write", "a note, another file or a folder renamed"],
  move: ["write", "a note, another file or a folder put into another folder"],
  trash: ["write", "a note, another file or a folder deleted — or several at once (paths)"],
  download: ["answer", "a note or another file handed out: the browser saves it (the share window, a file's menu)"],
  pasteimage: ["write", "a picture from the clipboard, kept beside the note"],
  dropfiles: ["write", "files dropped on a note, by their addresses (a browser has the files themselves: MdHost.drop)"],
  "history-restore": ["write", "a version put back as the note"],
  "share-info": ["answer", "how a note's sharing stands"],
  "share-set": ["write", "a note shared under a link, or its password set, changed or taken away"],
  "share-stop": ["write", "a note shared no more"],
  "history-now": ["write", "Ctrl+S: kept now"],
  "sync-resolve": ["write", "the conflicts' window: joined as picked"],
  // the history
  "history-log": ["answer", "a note's versions: the commits of its path"],
  "history-text": ["answer", "a note as a version has it"],
  "sync-conflicts": ["answer", "what stands in the way of a commit: the same shape as the shell's"],
  // the browser's own
  copy: ["local", "text onto the clipboard"],
  copyimage: ["local", "a picture onto the clipboard"],
  pasteclip: ["local", "the clipboard's text and HTML, for a paste as the user's choice"],
  pastetext: ["local", "the clipboard's plain text"],
  editcmd: ["local", "cut, copy, paste, select all where the focus is"],
  external: ["local", "an address elsewhere, in a new tab"],
  print: ["local", "the browser's printing"],
  painted: ["none", "the first frame is out: nothing to lift here"],
  // not in a browser
  fileop: ["none", "open in the default app, open with, show in the file manager"],
  "history-enable": ["write", "a repository that is no project yet is made one: the marker, as a commit"],
  "history-disable": ["none", "a repository opened here has its history"],
  "history-link": ["none", "it is the repository"],
  "github-signin": ["none", "signing in is the web app's own, before any page"],
  "github-open": ["none", "as github-signin"],
  "github-cancel": ["none", "as github-signin"],
  "github-signout": ["none", "as github-signin"],
  "github-repos": ["none", "the repositories are chosen before the page"],
  "github-give": ["none", "as github-repos"],
  "github-get": ["none", "as github-repos"],
  // decided against: no AI in the web app
  complete: ["none", "the next words suggested while typing"],
  graphic: ["none", "a figure drawn by a model"],
  "graphic-cancel": ["none", "as graphic"],
  "graphic-image": ["none", "as graphic"],
  "graphic-save": ["none", "as graphic"],
  aikey: ["none", "the model's key"],
  // the desktop's test rig
  zoom: ["none", "rig only"],
  log: ["none", "rig only"],
  probe: ["none", "rig only"],
  snapshot: ["none", "rig only"],
  "probe-pointer": ["none", "rig only"],
};

/** What the page is told: MdView.<name>(…). */
export const TO_PAGE: Record<string, [Does, string]> = {
  render: ["answer", "a note to show: its text, name, path, what its wikilinks lead to, where relative addresses start"],
  setFolder: ["answer", "the repository as a tree, and how the sidebar is set"],
  setTabs: ["answer", "the tabs"],
  setMode: ["answer", "the mode to be in"],
  setPrefs: ["answer", "the settings"],
  setTheme: ["answer", "the colours: light or dark, as the system has it"],
  setPreviews: ["answer", "the beginnings of notes asked for"],
  settingsInfo: ["answer", "what only the host knows, for the settings"],
  toast: ["answer", "a word shown for a moment"],
  clear: ["answer", "nothing to show"],
  scrollToFragment: ["answer", "to a place in the note shown"],
  linkResolved: ["answer", "where a link leads"],
  pdfChunk: ["answer", "a piece of a PDF"],
  share: ["answer", "how a note's sharing stands: whether it can be, its link, whether it has a password"],
  history: ["answer", "a note's versions"],
  historyText: ["answer", "a note as a version has it"],
  flush: ["write", "what is typed is to be saved now"],
  saveFailed: ["write", "a save did not go"],
  busy: ["write", "the window is busy with something that must not be done twice (a file on its way into the repository), or no more"],
  noteRenamed: ["write", "a note has another name"],
  insertImage: ["write", "a picture was kept: its markup, to be put in"],
  insertDropped: ["write", "dropped files were kept"],
  filesBack: ["write", "files that went with what showed them are back (the removal undone): their pictures are loaded anew"],
  historyRestored: ["write", "a version was put back"],
  historyKept: ["write", "a version was kept: what the settings show is no longer so"],
  conflicts: ["write", "what is to be said before a commit can be made"],
  conflictsFailed: ["write", "the joining did not go"],
  pasteClip: ["local", "what the clipboard holds"],
  pasteText: ["local", "the clipboard's plain text"],
  completion: ["none", "no AI in the web app"],
  graphic: ["none", "as completion"],
  graphicImage: ["none", "as completion"],
};

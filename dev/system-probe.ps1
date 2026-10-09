# The app started with dev/probe-windows.js in its page (see .github/workflows/system-probe.yml):
#   pwsh dev/system-probe.ps1 -Exe path\to\mdview.exe [-Assets checkout] [-Setup] [-Strict]
# The probe asks for the system's own windows (a picture to insert, a folder to open); this types
# the path into each and reports which windows there were. Everything lands in .\out.
#   -Setup   makes the notes the app opens (work\, outside\) and the probe with its picture's address
#   -Strict  ends with an error unless everything held that can be asked for certain: the page
#            reported, without errors, with its style sheets and colours; the pictures show; a file
#            handed over was put in and shows; started with a folder, the sidebar holds its notes.
#            (The system's own windows are tried and told of, and nothing depends on them.)
param([string]$Exe, [string]$Assets = "", [string]$Tag = "run", [switch]$Setup, [switch]$Strict)
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class Wins {
  delegate bool Each(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Each f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static List<string> All() { var o = new List<string>(); EnumWindows((h, l) => { if (IsWindowVisible(h)) { var t = new StringBuilder(256); var c = new StringBuilder(256); GetWindowText(h, t, 256); GetClassName(h, c, 256); uint pid; GetWindowThreadProcessId(h, out pid); if (t.Length > 0) o.Add(h + "|" + pid + "|" + c + "|" + t); } return true; }, IntPtr.Zero); return o; }
}
"@
function Shot($name) { $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save("$PWD\out\$Tag-$name.png") }
function Windows-Of($procId) { [Wins]::All() | Where-Object { $_.Split("|")[1] -eq "$procId" } }
function Answer($title, $path, $procId) {
  # The system's window, found by its title and brought to the front: the path is typed into it. Typed keys arrive only
  # when the window really is in front, which a machine nobody sits at does not promise — so this is tried and told of,
  # and nothing is made to depend on it (what stands behind the window is asked without it: a file handed over, a folder
  # given when the app is started).
  Start-Sleep 3
  "---- windows of the app after asking for '$title':"; Windows-Of $procId
  $there = { [Wins]::All() | Where-Object { $_.Split("|")[3] -eq $title } | Select-Object -First 1 }
  Shot "asked-$($title -replace ' ', '-')"
  if (-not (& $there)) { "!! no window titled '$title'"; return }
  for ($try = 1; $try -le 3 -and (& $there); $try++) {
    [Wins]::SetForegroundWindow([IntPtr][long](& $there).Split("|")[0]) | Out-Null
    Start-Sleep 1
    [System.Windows.Forms.SendKeys]::SendWait($path); Start-Sleep 1
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); Start-Sleep 2
    if (& $there) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); Start-Sleep 2 } # (a folder's window: gone into it first, then chosen)
    "     try ${try}: the window is $(if (& $there) { 'still there' } else { 'gone' })"
  }
  Shot "answered-$($title -replace ' ', '-')"
}
if ($Setup) {
  New-Item -ItemType Directory -Force work, work\sub, outside | Out-Null
  foreach ($to in "work\pic.png", "outside\photo.png", "outside\second.png") { Copy-Item dev\tests\tauri-check\bild.png $to }
  Set-Content -Encoding utf8 work\Note.md "# A note`n`nText with a [link](sub/Deep.md).`n`n![a picture](pic.png)`n`nLast paragraph.`n"
  Set-Content -Encoding utf8 work\sub\Deep.md "# Deep`n`ntext`n"
  Set-Content -Encoding utf8 probe.js ("window.__probePicture = " + (([System.Uri]("$PWD\outside\photo.png")).AbsoluteUri | ConvertTo-Json) + ";")
  Get-Content dev\probe-windows.js | Add-Content -Encoding utf8 probe.js
}
New-Item -ItemType Directory -Force out | Out-Null
Remove-Item out\*.json -ErrorAction SilentlyContinue
$env:MDVIEW_PROBE = "$PWD\probe.js"; $env:MDVIEW_PROBE_OUT = "$PWD\out"; $env:MDVIEW_DEBUG = "1"; $env:MDVIEW_NO_KEYRING = "1"
if ($Assets) { $env:MDVIEW_ASSETS = $Assets } else { Remove-Item Env:MDVIEW_ASSETS -ErrorAction SilentlyContinue }
"==== $Tag : $Exe"
$p = Start-Process -FilePath $Exe -ArgumentList "`"$PWD\work\Note.md`"" -PassThru -RedirectStandardError "$Tag.err.log" -RedirectStandardOutput "$Tag.out.log"
$wait = { param($file, $secs) for ($i = 0; $i -lt $secs -and -not (Test-Path "out\Note.md.$file.json"); $i++) { Start-Sleep 1 }; Test-Path "out\Note.md.$file.json" }
if (-not (& $wait "windows" 90)) { "!! the page reported nothing"; Shot "silent"; "---- windows:"; [Wins]::All() }
else {
  Shot "note"
  if (& $wait "asked-picture" 30) { Answer "Insert Picture" "$PWD\outside\second.png" $p.Id; & $wait "picture" 70 | Out-Null }
  if (& $wait "asked-folder" 80) { Answer "Open Folder" "$PWD\work\sub" $p.Id; & $wait "folder" 70 | Out-Null }
  Shot "end"
}
"---- windows of the app at the end:"; Windows-Of $p.Id
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Get-ChildItem out\*.json | ForEach-Object { "==== $($_.Name)"; Get-Content $_; Copy-Item $_ "out\$Tag-$($_.Name)" }
# ---- started with a folder: what a folder chosen in the system's window leads to, without the window
Get-ChildItem out\*.json | Where-Object { $_.Name -notlike "$Tag-*" } | Remove-Item
Start-Sleep 2
"==== $Tag : $Exe, with a folder"
$f = Start-Process -FilePath $Exe -ArgumentList "`"$PWD\work`"" -PassThru -RedirectStandardError "$Tag.folder.err.log" -RedirectStandardOutput "$Tag.folder.out.log"
for ($i = 0; $i -lt 90 -and -not (Get-ChildItem out\*.first.json -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "$Tag-*" }); $i++) { Start-Sleep 1 }
Start-Sleep 1
Shot "with-folder"
if (-not $f.HasExited) { Stop-Process -Id $f.Id -Force }
Get-ChildItem out\*.first.json | Where-Object { $_.Name -notlike "$Tag-*" } | Select-Object -First 1 | ForEach-Object { "==== with a folder: $($_.Name)"; Get-Content $_; Copy-Item $_ "out\$Tag-with-folder.json" }
Get-ChildItem out\*.json | Where-Object { $_.Name -notlike "$Tag-*" } | Remove-Item
"==== stderr"; Get-Content "$Tag.err.log" -ErrorAction SilentlyContinue | Select-Object -Last 30
"==== the note's folder"; Get-ChildItem -Recurse work | ForEach-Object { $_.FullName }
# ---- what held
$bad = @()
$read = { param($name) $f = "out\$Tag-$name.json"; if (Test-Path $f) { Get-Content $f -Raw | ConvertFrom-Json } else { $null } }
$page = & $read "Note.md.windows"; $pic = & $read "Note.md.picture"; $with = & $read "with-folder"; $fold = Get-ChildItem "out\$Tag-*.folder.json" -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json }
if (-not $page) { $bad += "the page reported nothing" }
else {
  if ($page.error) { $bad += "the probe failed: $($page.error)" }
  if (@($page.errors).Count) { $bad += "errors in the page: $(@($page.errors) -join '; ')" }
  if (-not $page.colours.'--c-red' -or -not $page.colours.'--c-accent') { $bad += "colours are missing" }
  if (@($page.sheets | Where-Object { $_[1] -is [string] -or $_[1] -lt 1 }).Count) { $bad += "a style sheet did not load" } # (a sheet that cannot be read reports why, in words; one that loaded, how many rules)
  if (-not @($page.pictures).Count -or @($page.pictures | Where-Object { -not $_.ok }).Count) { $bad += "the picture beside the note does not show" }
  if (-not $page.inserted) { $bad += "a file handed over was not put in" }
  if (@($page.activePictures | Where-Object { $_.src -ne "null" -and -not $_.ok }).Count) { $bad += "a picture put in does not show" }
  if (-not @($page.deco).Count) { $bad += "the colours a block can be given are missing" }
}
if (-not $with) { $bad += "started with a folder, the page reported nothing" }
elseif ($null -eq $with.note.folder -or @($with.sidebarRows).Count -lt 2 -or @($with.errors).Count) { $bad += "started with a folder, the sidebar does not hold its notes" }
# (told of, not counted)
"---- the system's own windows: a picture chosen $(if ($pic -and $pic.inserted) { 'was put in' } else { 'was NOT put in (the typed path may not have arrived)' }); a folder chosen $(if ($fold -and $fold.opened) { 'was opened' } else { 'was NOT opened (the typed path may not have arrived)' })"
if ($bad.Count) { "==== NOT HELD ($Tag):"; $bad | ForEach-Object { "  - $_" }; if ($Strict) { exit 1 } } else { "==== everything held ($Tag)" }

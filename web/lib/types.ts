// What kind of content a file of a repository is sent as, by its ending. Anything else is handed
// out as a download, never shown.
export const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  pdf: "application/pdf", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", opus: "audio/ogg", webm: "video/webm",
  mp4: "video/mp4", mov: "video/quicktime", ogv: "video/ogg", mkv: "video/x-matroska",
  md: "text/plain; charset=utf-8", markdown: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8", json: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8",
};

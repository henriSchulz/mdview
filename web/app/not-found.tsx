// An address of the app's own that is none: a shrug, and the number. (A shared note's link that
// shows nothing has the same page: lib/sharepage.ts, shrug.)
export const metadata = { title: "404" };

export default function NotFound() {
  return (
    <main className="shrug-page">
      <p className="shrug" aria-hidden="true">{"¯\\_(ツ)_/¯"}</p>
      <h1>404</h1>
    </main>
  );
}

"use client";
// Something of the app's own went wrong while a page was made: said, with a way to try again —
// not the framework's bare page. (The shrug the 404 has.)

export default function Failed({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="shrug-page">
      <p className="shrug" aria-hidden="true">{"¯\\_(ツ)_/¯"}</p>
      <h1>Something went wrong</h1>
      <p><button type="button" onClick={() => reset()}>Try again</button></p>
    </main>
  );
}

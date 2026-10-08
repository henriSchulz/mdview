"use client";
// … and where the layout itself could not be made: a page of its own, whole.

export default function Failed({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ font: "16px system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p><button type="button" onClick={() => reset()}>Try again</button></p>
        </main>
      </body>
    </html>
  );
}

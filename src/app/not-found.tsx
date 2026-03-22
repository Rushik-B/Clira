import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
        404
      </p>
      <h1 className="text-3xl font-semibold text-foreground">
        Page not found
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you requested does not exist or is no longer available.
      </p>
      <Link
        href="/"
        className="inline-flex rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        Return home
      </Link>
    </main>
  );
}

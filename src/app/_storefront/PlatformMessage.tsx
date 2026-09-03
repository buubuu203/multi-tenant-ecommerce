// Platform-branded (not tenant-branded) fallback page, used when a tenant is
// suspended/archived or a domain doesn't resolve to any tenant at all.
export function PlatformMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </main>
  );
}

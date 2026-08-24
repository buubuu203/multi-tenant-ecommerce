import { PlatformMessage } from "./_storefront/PlatformMessage";

// Next.js renders this automatically (with a real HTTP 404 status) for any
// request path that doesn't match a route — including the path src/proxy.ts
// rewrites unresolved hostnames to, since no page exists there.
export default function NotFound() {
  return (
    <PlatformMessage
      title="Store not found"
      body="We couldn't find a store at this address. Double-check the URL and try again."
    />
  );
}

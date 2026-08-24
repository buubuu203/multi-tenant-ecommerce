import { PlatformMessage } from "../_storefront/PlatformMessage";

export const dynamic = "force-dynamic";

export default function StoreNotFoundPage() {
  return (
    <PlatformMessage
      title="Store not found"
      body="We couldn't find a store at this address. Double-check the URL and try again."
    />
  );
}

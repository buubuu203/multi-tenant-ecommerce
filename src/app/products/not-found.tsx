import { PlatformMessage } from "../_storefront/PlatformMessage";

// Reached via notFound() in [productId]/page.tsx for any of: nonexistent
// id, a product belonging to another tenant, or a draft product — all
// three deliberately indistinguishable here (see getTenantProduct()'s doc
// comment), so this message never reveals which case occurred.
export default function ProductNotFound() {
  return (
    <PlatformMessage
      title="Product not found"
      body="This product doesn't exist or is no longer available."
    />
  );
}

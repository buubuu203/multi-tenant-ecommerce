import { OrderLookupForm } from "./OrderLookupForm";

// "Track your order" entry point — for a returning guest who doesn't have
// their bookmarked confirmation link. No accounts/sessions: both Order ID
// and the checkout email are entered here (see OrderLookupForm and
// getOrderForCustomer()'s doc comments for the access-control rationale).
export const dynamic = "force-dynamic";

export default function TrackOrderPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Track your order</h1>
        <p className="text-sm text-muted-foreground">
          Enter your order ID and the email you used at checkout.
        </p>
      </div>
      <OrderLookupForm />
    </main>
  );
}

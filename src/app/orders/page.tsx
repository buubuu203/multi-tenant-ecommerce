import { OrderLookupForm } from "./OrderLookupForm";

// "Track your order" entry point — for a returning guest who doesn't have
// their bookmarked confirmation link. No accounts/sessions: both Order ID
// and the checkout email are entered here (see OrderLookupForm and
// getOrderForCustomer()'s doc comments for the access-control rationale).
export const dynamic = "force-dynamic";

export default function TrackOrderPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Track your order</h1>
        <p className="text-black/70 dark:text-white/70">
          Enter your order ID and the email you used at checkout.
        </p>
      </div>
      <OrderLookupForm />
    </main>
  );
}

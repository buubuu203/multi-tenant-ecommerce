import { OrderLookupForm } from "../OrderLookupForm";

// The bookmarkable order-confirmation link a customer is given right
// after checkout (see CartWidget.tsx's success state). The order ID alone
// in the URL is NOT sufficient to view the order — this page still
// requires the checkout email, submitted via OrderLookupForm's POST
// action, never appended to this URL. See order-queries.ts's
// getOrderForCustomer() for why Order ID + email together are the entire
// access-control mechanism (there are no customer accounts).
export const dynamic = "force-dynamic";

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  return (
    <main className="flex flex-1 flex-col gap-4 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Your order</h1>
        <p className="text-black/70 dark:text-white/70">
          Enter the email you used at checkout to view order <span className="font-mono">{orderId}</span>.
        </p>
      </div>
      <OrderLookupForm fixedOrderId={orderId} />
    </main>
  );
}

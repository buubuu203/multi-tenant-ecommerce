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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your order</h1>
        <p className="text-sm text-muted-foreground">
          Enter the email you used at checkout to view order <span className="font-mono">{orderId}</span>.
        </p>
      </div>
      <OrderLookupForm fixedOrderId={orderId} />
    </main>
  );
}

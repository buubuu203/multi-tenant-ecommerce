import { OrderLookupForm } from './OrderLookupForm';
import { getCurrentTenant } from '../_storefront/get-current-tenant';
import { resolveBranding } from '../_storefront/resolve-branding';
import { TenantTheme } from '@/components/TenantTheme';

// "Track your order" entry point — for a returning guest who doesn't have
// their bookmarked confirmation link. No accounts/sessions: both Order ID
// and the checkout email are entered here (see OrderLookupForm and
// getOrderForCustomer()'s doc comments for the access-control rationale).
export const dynamic = 'force-dynamic';

export default async function TrackOrderPage() {
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;
  const content = (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Track your order</h1>
        <p className="text-sm text-muted-foreground">
          Enter your order ID and the email you used at checkout.
        </p>
      </div>
      <OrderLookupForm />
    </main>
  );
  return branding ? <TenantTheme branding={branding}>{content}</TenantTheme> : content;
}

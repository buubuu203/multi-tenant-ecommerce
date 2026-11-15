import { OrderLookupForm } from './OrderLookupForm';
import { getCurrentTenant } from '../_storefront/get-current-tenant';
import { resolveBranding } from '../_storefront/resolve-branding';
import { TenantTheme } from '@/components/TenantTheme';
import { getLocale, getDictionary } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function TrackOrderPage() {
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const content = (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.orders.trackYourOrder}</h1>
        <p className="text-sm text-muted-foreground">
          {dict.orders.trackDescription}
        </p>
      </div>
      <OrderLookupForm />
    </main>
  );
  return branding ? <TenantTheme branding={branding}>{content}</TenantTheme> : content;
}

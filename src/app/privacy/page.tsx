import Link from 'next/link';
import { getCurrentTenant } from '../_storefront/get-current-tenant';
import { getCurrentPrivacyNotice } from '@/lib/privacy-mutations';
import { getDictionary, getLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PrivacyPage() {
  const [tenant, locale] = await Promise.all([getCurrentTenant(), getLocale()]);
  const dict = await getDictionary(locale);
  const notice = tenant ? await getCurrentPrivacyNotice(tenant.id) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
        {dict.privacy.backToStore}
      </Link>
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {tenant?.name ?? dict.storefront.storeNotFound}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{dict.privacy.title}</h1>
      </header>

      {!notice ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-medium">{dict.privacy.notPublishedTitle}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{dict.privacy.notPublishedBody}</p>
        </section>
      ) : (
        <>
          <dl className="grid gap-3 rounded-xl border border-border bg-surface p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{dict.privacy.controller}</dt>
              <dd className="mt-1 font-medium">{notice.controllerName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{dict.privacy.contact}</dt>
              <dd className="mt-1">
                <a className="underline" href={`mailto:${notice.contactEmail}`}>
                  {notice.contactEmail}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {dict.privacy.version.replace('{version}', String(notice.version))}
              </dt>
              <dd className="mt-1">
                {dict.privacy.published}{' '}
                <time dateTime={notice.publishedAt.toISOString()}>
                  {notice.publishedAt.toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                </time>
              </dd>
            </div>
          </dl>
          <article className="whitespace-pre-wrap break-words rounded-xl border border-border bg-surface p-5 text-sm leading-7">
            {locale === 'vi' ? notice.noticeTextVi : notice.noticeTextEn}
          </article>
        </>
      )}
    </main>
  );
}

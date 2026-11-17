import { ActionForm } from '@/components/ActionForm';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getCurrentPrivacyNotice, listPrivacyNoticeVersions } from '@/lib/privacy-mutations';
import { getDictionary, getLocale } from '@/lib/i18n';
import { AdminPageHeader } from '../AdminPageHeader';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
} from '../styles';
import { publishPrivacyNoticeAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function TenantPrivacyPage() {
  const { tenantId } = await requireTenantAdmin();
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const [current, versions] = await Promise.all([
    getCurrentPrivacyNotice(tenantId),
    listPrivacyNoticeVersions(tenantId),
  ]);

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title={dict.privacy.adminTitle}
        description={dict.privacy.adminDescription}
      />

      <section className={adminPanelClassName}>
        <h2 className={adminPanelTitleClassName}>{dict.privacy.beforePublishing}</h2>
        <p className="text-sm text-muted-foreground">{dict.privacy.approvalGuidance}</p>
        <p className="text-sm text-muted-foreground">{dict.privacy.checkoutRequirement}</p>
      </section>

      <ActionForm
        action={publishPrivacyNoticeAction}
        submitLabel={current ? dict.privacy.publishNewVersion : dict.privacy.publishNotice}
        successMessage={dict.privacy.publishedSuccess}
        pendingLabel={dict.common.working}
        className="flex max-w-3xl flex-col gap-4"
      >
        <section className={adminPanelClassName}>
          <h2 className={adminPanelTitleClassName}>{dict.privacy.controllerAndContact}</h2>
          <label className={adminLabelClassName}>
            {dict.privacy.controllerName}
            <input
              name="controllerName"
              required
              maxLength={200}
              defaultValue={current?.controllerName ?? ''}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            {dict.privacy.contactEmail}
            <input
              name="contactEmail"
              type="email"
              required
              maxLength={254}
              defaultValue={current?.contactEmail ?? ''}
              className={adminInputClassName}
            />
          </label>
        </section>

        <section className={adminPanelClassName}>
          <h2 className={adminPanelTitleClassName}>{dict.privacy.noticeTextTitle}</h2>
          <label className={adminLabelClassName}>
            {dict.privacy.noticeTextVi}
            <textarea
              name="noticeTextVi"
              required
              minLength={30}
              maxLength={20_000}
              rows={16}
              defaultValue={current?.noticeTextVi ?? ''}
              className={`${adminInputClassName} min-h-64 resize-y`}
            />
          </label>
          <label className={adminLabelClassName}>
            {dict.privacy.noticeTextEn}
            <textarea
              name="noticeTextEn"
              required
              minLength={30}
              maxLength={20_000}
              rows={16}
              defaultValue={current?.noticeTextEn ?? ''}
              className={`${adminInputClassName} min-h-64 resize-y`}
            />
          </label>
          <p className="text-xs text-muted-foreground">{dict.privacy.requiredBothLanguages}</p>
        </section>
      </ActionForm>

      {versions.length > 0 && (
        <section className={adminPanelClassName} aria-labelledby="privacy-history">
          <h2 id="privacy-history" className={adminPanelTitleClassName}>
            {dict.privacy.publishedVersions}
          </h2>
          <ol className="flex flex-col gap-2 text-sm">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {dict.privacy.version.replace('{version}', String(version.version))}
                  {version.isCurrent ? ` ${dict.privacy.currentVersion}` : ''}
                </span>
                <time dateTime={version.publishedAt.toISOString()}>
                  {version.publishedAt.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

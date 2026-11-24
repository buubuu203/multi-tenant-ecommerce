import type { Metadata } from 'next';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { ActionForm } from '@/components/ActionForm';
import { updateBrandingAction } from '../actions';
import { BrandingUploadControls } from '../BrandingUploadControls';
import { TelegramTestButton } from '../TelegramTestButton';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Thương hiệu' };

export default async function BrandingPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Branding"
        description="Your store name, logo and colours, used across the storefront."
      />
      <ActionForm
        action={updateBrandingAction}
        submitLabel="Save branding"
        successMessage="Branding saved."
        className="flex max-w-xl flex-col gap-4"
      >
        {/* Identity first, assets after: the store name is what every
            other setting on this page decorates. */}
        <section aria-labelledby="brand-identity" className={adminPanelClassName}>
          <h3 id="brand-identity" className={adminPanelTitleClassName}>
            Store identity
          </h3>
          <label className={adminLabelClassName}>
            Store name
            <input
              name="storeName"
              defaultValue={branding?.storeName ?? ''}
              placeholder={tenant?.name}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Tagline (optional)
            <input
              name="tagline"
              defaultValue={branding?.tagline ?? ''}
              placeholder="A short line shown under your store name in the footer"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            SEO / social share description (optional)
            <textarea
              name="ogDescription"
              defaultValue={branding?.ogDescription ?? ''}
              placeholder="A longer sentence for Google search results and Facebook/Zalo link previews — falls back to the tagline above if left blank"
              rows={2}
              className={adminInputClassName}
            />
            <span className="text-xs text-muted-foreground">
              Shown on Google and on link previews (Facebook, Zalo, Messenger). The tagline above
              stays short for the footer and share-card title; this can be a full sentence.
            </span>
          </label>
        </section>
        <section aria-labelledby="brand-assets" className={adminPanelClassName}>
          <h3 id="brand-assets" className={adminPanelTitleClassName}>
            Logo, favicon and design tokens
          </h3>
          <BrandingUploadControls
            initialLogoUrl={branding?.logoUrl ?? ''}
            initialFaviconUrl={branding?.faviconUrl ?? ''}
            hasTokens={Boolean(branding?.designTokens)}
          />
        </section>
        {/* Storefront footer (UI/UX revamp, Board 5): every field here is
            optional — the storefront footer shows each line only when
            it's filled in, never a placeholder, so leaving any of these
            blank is a normal, supported state, not a draft. */}
        <section aria-labelledby="brand-footer" className={adminPanelClassName}>
          <h3 id="brand-footer" className={adminPanelTitleClassName}>
            Footer contact info
          </h3>
          <label className={adminLabelClassName}>
            Address
            <input name="address" defaultValue={branding?.address ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Phone
            <input name="phone" defaultValue={branding?.phone ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Contact email
            <input
              name="contactEmail"
              type="email"
              defaultValue={branding?.contactEmail ?? ''}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Business registration ID
            <input name="businessId" defaultValue={branding?.businessId ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Facebook URL
            <input name="facebookUrl" defaultValue={branding?.facebookUrl ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Instagram URL
            <input
              name="instagramUrl"
              placeholder="https://www.instagram.com/..."
              defaultValue={branding?.instagramUrl ?? ''}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            TikTok Shop URL
            <input name="tiktokUrl" defaultValue={branding?.tiktokUrl ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Zalo URL
            <input name="zaloUrl" defaultValue={branding?.zaloUrl ?? ''} className={adminInputClassName} />
          </label>
        </section>
        <section aria-labelledby="brand-telegram" className={adminPanelClassName}>
          <h3 id="brand-telegram" className={adminPanelTitleClassName}>
            Thông báo đơn hàng mới (Telegram)
          </h3>
          <p className="text-xs text-muted-foreground">
            Nhận tin nhắn Telegram ngay khi có đơn hàng mới. Để trống cả hai ô để tắt tính năng này.
            Cách lấy thông tin: nhắn <code>/newbot</code> cho{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              @BotFather
            </a>{' '}
            trên Telegram để tạo bot và lấy Bot Token, sau đó nhắn bất kỳ tin nào cho bot của bạn rồi mở{' '}
            <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> để lấy Chat ID.
          </p>
          <label className={adminLabelClassName}>
            Bot Token
            <input
              name="telegramBotToken"
              defaultValue={branding?.telegramBotToken ?? ''}
              placeholder="123456789:AAExampleTokenFromBotFather"
              autoComplete="off"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Chat ID
            <input
              name="telegramChatId"
              defaultValue={branding?.telegramChatId ?? ''}
              placeholder="123456789"
              autoComplete="off"
              className={adminInputClassName}
            />
          </label>
          {branding?.telegramBotToken && branding?.telegramChatId && <TelegramTestButton />}
        </section>
      </ActionForm>
    </div>
  );
}

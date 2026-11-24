import type { Metadata } from 'next';
import { getCurrentTenant } from '../../_storefront/get-current-tenant';
import { resolveBranding, resolveFooterContact } from '../../_storefront/resolve-branding';
import { getRequestOrigin } from '@/lib/seo/request-origin';
import { Icon } from '../../_storefront/Icon';

// Static content, but still tenant-aware: every multi-tenant storefront on
// this deployment gets its own version of this page at its own host, with
// its own store name and contact details — never one tenant's copy
// leaking into another's (same force-dynamic posture as every other
// tenant-scoped page here, see src/proxy.ts).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [tenant, origin] = await Promise.all([getCurrentTenant(), getRequestOrigin()]);
  if (!tenant) return {};
  const storeName = tenant.branding?.storeName || tenant.name;
  const title = `In 3D theo yêu cầu & Nhận sỉ — ${storeName}`;
  const description =
    `${storeName} nhận in 3D theo mẫu riêng của bạn: gửi ý tưởng hoặc file thiết kế, ` +
    `${storeName} báo giá và thời gian giao trước khi làm. Cũng nhận hợp tác bán sỉ số lượng lớn.`;
  const url = origin ? `${origin}/dich-vu` : undefined;
  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      title,
      description,
      ...(url ? { url } : {}),
      siteName: storeName,
      locale: 'vi_VN',
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ServicesPage() {
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;
  const contact = tenant ? resolveFooterContact(tenant.branding) : null;
  const storeName = branding?.storeName ?? 'Cửa hàng';

  const hasZalo = Boolean(contact?.zaloUrl);
  const hasPhone = Boolean(contact?.phone);
  const hasEmail = Boolean(contact?.email);

  return (
    <main className="flex flex-1 flex-col gap-10 py-6">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Dịch vụ</span>
        <h1 className="display-section" style={{ fontSize: 'clamp(26px, 4vw, 36px)', margin: 0 }}>
          In 3D theo yêu cầu &amp; Nhận sỉ
        </h1>
        <p className="text-sm" style={{ color: 'var(--ink-2)', maxWidth: '640px' }}>
          Ngoài các mẫu có sẵn trong cửa hàng, {storeName} còn nhận in 3D theo ý tưởng riêng của
          bạn và hợp tác bán sỉ cho shop, đại lý muốn nhập số lượng lớn.
        </p>
      </div>

      <section
        id="in-theo-yeu-cau"
        className="glass flex flex-col gap-5 p-6 sm:p-8"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="title-card" style={{ fontSize: '24px', margin: 0 }}>
            In 3D theo yêu cầu, đúng mẫu bạn gửi
          </h2>
          <p className="text-sm leading-7" style={{ color: 'var(--ink-2)' }}>
            Có ý tưởng riêng, một món quà tặng đặc biệt, hoặc một chi tiết cần in theo kích thước
            cụ thể? {storeName} nhận in 3D theo mẫu, theo file thiết kế, hoặc theo ảnh/ý tưởng mô
            tả lại — không giới hạn ở các mẫu đang bán trong cửa hàng.
          </p>
        </div>

        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[
            { title: 'Gửi mẫu / ý tưởng', body: 'Gửi file thiết kế (STL, OBJ...), ảnh mẫu, hoặc mô tả ý tưởng qua Zalo/điện thoại/email.' },
            { title: 'Báo giá', body: `${storeName} xem mẫu và báo giá cụ thể trước khi bạn quyết định đặt.` },
            { title: 'Báo thời gian giao', body: 'Kèm theo giá là thời gian in và giao dự kiến, để bạn chủ động sắp xếp.' },
            { title: 'Xác nhận & sản xuất', body: 'Đồng ý giá và thời gian, đơn được lên lịch in và giao như đã báo.' },
          ].map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2 rounded-lg border p-4" style={{ borderColor: 'var(--divider)' }}>
              <span className="chip" style={{ width: 'fit-content', minHeight: 0, padding: '2px 10px' }}>
                Bước {i + 1}
              </span>
              <span className="font-medium" style={{ fontSize: '15px' }}>{step.title}</span>
              <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{step.body}</span>
            </li>
          ))}
        </ol>

        <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
          Giá và thời gian giao phụ thuộc vào độ phức tạp, kích thước và vật liệu của mẫu — luôn
          được báo cụ thể trước, không có chi phí phát sinh ngoài những gì đã xác nhận.
        </p>
      </section>

      <section
        id="ban-si"
        className="glass flex flex-col gap-4 p-6 sm:p-8"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="title-card" style={{ fontSize: '24px', margin: 0 }}>
            Nhận sỉ cho shop, đại lý
          </h2>
          <p className="text-sm leading-7" style={{ color: 'var(--ink-2)' }}>
            {storeName} nhận hợp tác bán sỉ các mẫu đồ chơi, quà tặng và đồ decor in 3D cho shop
            online, cửa hàng và đại lý đặt số lượng lớn. Liên hệ để được báo bảng giá sỉ riêng theo
            số lượng và danh mục bạn cần.
          </p>
        </div>
      </section>

      {(hasZalo || hasPhone || hasEmail) && (
        <section
          className="glass flex flex-col gap-3 p-6 sm:p-8"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <h2 className="title-card" style={{ fontSize: '20px', margin: 0 }}>
            Liên hệ {storeName}
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {hasZalo && (
              <a href={contact!.zaloUrl!} target="_blank" rel="noreferrer" className="chip" style={{ minHeight: '44px' }}>
                <Icon name="phone" size={15} />
                Nhắn Zalo
              </a>
            )}
            {hasPhone && (
              <a href={`tel:${contact!.phone}`} className="chip" style={{ minHeight: '44px' }}>
                <Icon name="phone" size={15} />
                {contact!.phone}
              </a>
            )}
            {hasEmail && (
              <a href={`mailto:${contact!.email}`} className="chip" style={{ minHeight: '44px' }}>
                <Icon name="mail" size={15} />
                {contact!.email}
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

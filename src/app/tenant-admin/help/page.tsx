import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { AdminPageHeader } from '../AdminPageHeader';
import { HELP_SECTIONS, QUICK_START } from './help-content';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminEyebrowClassName,
  adminButtonSecondaryClassName,
} from '../styles';

/**
 * Hướng dẫn sử dụng Tenant Admin.
 *
 * Authorized like every other admin route, but it reads NO tenant data:
 * the content is static and the only reason this calls
 * requireTenantAdmin() is to keep the guide behind the same door as the
 * pages it describes. Nothing tenant-specific is rendered, so there is
 * nothing here to leak.
 */
export const dynamic = 'force-dynamic';

// Never indexed: it sits behind authorization and describes internal tools.
export const metadata = {
  title: 'Hướng dẫn sử dụng',
  robots: { index: false, follow: false },
};

export default async function HelpPage() {
  await requireTenantAdmin();

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Hướng dẫn sử dụng"
        description="Giải thích từng trang trong khu vực quản trị cửa hàng: dùng để làm gì, các bước thường dùng, và những giới hạn cần biết."
      />

      <section aria-labelledby="gioi-thieu" className={adminPanelClassName}>
        <h3 id="gioi-thieu" className={adminPanelTitleClassName}>
          Trước khi bắt đầu
        </h3>
        <p className="text-sm text-muted-foreground">
          Khu vực quản trị này chỉ làm việc với dữ liệu của đúng cửa hàng bạn đang đăng nhập. Bạn
          không nhìn thấy đơn hàng, khách hàng hay sản phẩm của cửa hàng khác. Bấm dấu{' '}
          <strong className="font-semibold text-foreground">?</strong> ở thanh trên cùng để quay lại
          trang hướng dẫn này bất cứ lúc nào.
        </p>
        <p className="text-sm text-muted-foreground">
          Đây là tài liệu hướng dẫn sử dụng. Đây không phải phần mềm kế toán, không phải hệ thống
          hoá đơn VAT hay hoá đơn điện tử, không phải hệ thống đối soát ngân hàng, và không kết nối
          với đơn vị vận chuyển nào.
        </p>
      </section>

      <section aria-labelledby="bat-dau-nhanh" className={adminPanelClassName}>
        <h3 id="bat-dau-nhanh" className={adminPanelTitleClassName}>
          Bắt đầu nhanh
        </h3>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          {QUICK_START.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <nav aria-labelledby="muc-luc" className={adminPanelClassName}>
        <h3 id="muc-luc" className={adminPanelTitleClassName}>
          Mục lục
        </h3>
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm sm:grid-cols-2">
          {HELP_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {HELP_SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-title`}
          className={adminPanelClassName}
        >
          <div className="flex flex-col gap-1">
            <h2 id={`${section.id}-title`} className="text-base font-semibold tracking-tight">
              {section.title}
            </h2>
            <p className="text-sm text-muted-foreground">{section.purpose}</p>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className={adminEyebrowClassName}>Bạn có thể làm gì</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {section.canDo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className={adminEyebrowClassName}>Quy trình thường dùng</h3>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
              {section.workflow.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className={adminEyebrowClassName}>Khái niệm quan trọng</h3>
            <dl className="flex flex-col gap-2 text-sm">
              {section.concepts.map((concept) => (
                <div key={concept.term} className="flex flex-col gap-0.5">
                  <dt className="font-medium">{concept.term}</dt>
                  <dd className="text-muted-foreground">{concept.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Giới hạn nằm ngay trong phần của trang đó, không gom riêng một
              chỗ — người đọc cần biết giới hạn đúng lúc đang đọc về trang. */}
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h3 className={adminEyebrowClassName}>Giới hạn cần biết</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {section.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </div>

          <div className="border-t border-border pt-3">
            {section.route ? (
              <Link
                href={section.route}
                aria-label={`Đi tới trang ${section.title}`}
                className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
              >
                Đi tới trang {section.title}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">{section.routeNote}</p>
            )}
          </div>
        </section>
      ))}

      <section aria-labelledby="ho-tro" className={adminSubtleClassName}>
        <h2 id="ho-tro" className={adminPanelTitleClassName}>
          Nếu vẫn còn vướng mắc
        </h2>
        <p className="text-xs text-muted-foreground">
          Hướng dẫn này mô tả đúng những gì phần mềm hiện có. Nếu bạn cần một chức năng chưa được
          nhắc tới ở đây, nghĩa là phần mềm chưa có chức năng đó — hãy liên hệ người quản trị hệ
          thống của bạn.
        </p>
      </section>
    </div>
  );
}

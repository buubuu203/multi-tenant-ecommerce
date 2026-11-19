// "Chính sách mua hàng" — Board 5's footer links to this. Content here is
// deliberately minimal: only the one sentence the user explicitly
// supplied ("Không hỗ trợ đổi trả, vui lòng kiểm tra kỹ trước khi đặt").
// The rest of the page's real content is still pending from them — see
// this pass's decision log. No return/exchange policy is invented here.
export const dynamic = 'force-dynamic';

export default function PurchasePolicyPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 py-6">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Chính sách</span>
        <h1 className="display-section" style={{ fontSize: 'clamp(26px, 4vw, 36px)', margin: 0 }}>
          Chính sách mua hàng
        </h1>
      </div>
      <div className="glass p-6 sm:p-8" style={{ borderRadius: 'var(--radius-card)' }}>
        <p className="text-sm leading-7" style={{ color: 'var(--ink-2)' }}>
          Không hỗ trợ đổi trả, vui lòng kiểm tra kỹ trước khi đặt.
        </p>
      </div>
    </main>
  );
}

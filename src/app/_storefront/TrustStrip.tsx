"use client";

import { Icon, type IconName } from "./Icon";
import { useDictionary } from "@/lib/i18n/use-dictionary";

// Board 5's 4-column trust strip. Static copy, deliberately with NO
// specific freeship threshold or dollar figure — that number has nowhere
// real to come from yet (see this pass's decision log: the notice bar
// that WOULD carry it stays hidden until a tenant-configurable field
// exists), so this only ever states policies that are true for every
// tenant regardless of their shipping/payment configuration.
export function TrustStrip() {
  const dict = useDictionary();
  const items: Array<{ icon: IconName; title: string; hint: string }> = [
    { icon: "truck", title: dict.trustStrip.shippingTitle, hint: dict.trustStrip.shippingHint },
    { icon: "box", title: dict.trustStrip.customPrintTitle, hint: dict.trustStrip.customPrintHint },
    { icon: "ticket", title: dict.trustStrip.paymentTitle, hint: dict.trustStrip.paymentHint },
    { icon: "zap", title: dict.trustStrip.supportTitle, hint: dict.trustStrip.supportHint },
  ];
  return (
    <section
      className="glass grid grid-cols-2 gap-4 sm:grid-cols-4"
      style={{ borderRadius: "var(--radius-card)", padding: "20px 26px" }}
    >
      {items.map((item) => (
        <div key={item.title} className="flex items-center gap-3">
          <span className="ibox">
            <Icon name={item.icon} size={18} />
          </span>
          <div>
            <b className="block text-[15px]">{item.title}</b>
            <div className="text-xs" style={{ color: "var(--ink-2)" }}>
              {item.hint}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

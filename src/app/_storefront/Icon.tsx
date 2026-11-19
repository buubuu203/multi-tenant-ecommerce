// Shared stroke-icon set for the buyer storefront. 1.75px stroke,
// currentColor — every icon inherits whatever color/size its containing
// button or text already sets, so nothing here hardcodes a palette.
// Paths are hand-reduced from Lucide's icon set (MIT-licensed, outline
// style), not copied wholesale, to keep this file dependency-free.
import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "cart"
  | "box"
  | "truck"
  | "ticket"
  | "shield"
  | "zap"
  | "sun"
  | "moon"
  | "globe"
  | "chevron"
  | "x"
  | "check"
  | "trash"
  | "heart"
  | "tag"
  | "lightbulb"
  | "gamepad"
  | "gift"
  | "briefcase"
  | "cable"
  | "gem"
  | "sort"
  | "plus"
  | "alert"
  | "info"
  | "person"
  | "pin"
  | "wallet"
  | "qrcode"
  | "mail"
  | "phone"
  | "store"
  | "play";

const PATHS: Record<IconName, string> = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3",
  cart: "M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L21 8H6 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  box: "m3 8 9-5 9 5-9 5-9-5Zm0 0v8l9 5m0-13v13m9-13v8l-9 5",
  truck: "M3 17V6a1 1 0 0 1 1-1h9v12H4a1 1 0 0 1-1-1Zm10-7h4.5l3.5 4v3a1 1 0 0 1-1 1h-1 M9 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  ticket:
    "M3 9a2 2 0 0 1 0-4h18a2 2 0 0 1 0 4 1.5 1.5 0 0 0 0 6 2 2 0 0 1 0 4H3a2 2 0 0 1 0-4 1.5 1.5 0 0 0 0-6Z M9 5v14",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z",
  zap: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z",
  sun: "M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m0-13 1.4 1.4m10.2 10.2 1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18Z",
  chevron: "m9 18 6-6-6-6",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6h14Z",
  heart:
    "M19.5 12.6 12 20l-7.5-7.4a4.8 4.8 0 0 1 0-6.8 4.9 4.9 0 0 1 6.9 0l.6.6.6-.6a4.9 4.9 0 0 1 6.9 0 4.8 4.8 0 0 1 0 6.8Z",
  tag: "M12.6 2.6 21 11l-9 9-8.4-8.4V3.2L12.6 2.6Z M7 7.5h.01",
  lightbulb: "M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.6.5 1 1.3 1 2.1V15h6v-.4c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 2Z",
  gamepad:
    "M6 11h4m-2-2v4M15.5 12h.01M18 10h.01 M4 7h16l1.5 7.5a2.5 2.5 0 0 1-4.6 1.9L15.5 15h-7l-1.4 1.4a2.5 2.5 0 0 1-4.6-1.9L4 7Z",
  gift: "M20 12v9H4v-9 M2 8h20v4H2V8Z M12 8v13 M12 8c-1.2-3-5-4.5-5-1.5S10 8 12 8ZM12 8c1.2-3 5-4.5 5-1.5S14 8 12 8Z",
  briefcase:
    "M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M3 12h18",
  cable:
    "M4 9v3a4 4 0 0 0 4 4h1 M9 4v4 M15 4v4 M9 2v2M15 2v2 M9 16v6M4 9a2 2 0 1 1 4 0v0a2 2 0 1 1-4 0ZM13 8a2 2 0 1 1 4 0v0a2 2 0 1 1-4 0Z",
  gem: "m6 3 12 0 4 6-10 12L2 9Z M2 9h20M11 3 8 9l4 12 4-12-3-6",
  sort: "M7 4v16m0-16-3 3m3-3 3 3M17 20V4m0 16 3-3m-3 3-3-3",
  plus: "M12 5v14M5 12h14",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 11h1v6h1",
  person: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM4 21a8 8 0 0 1 16 0",
  pin: "M12 21s-7-6.5-7-11.5a7 7 0 0 1 14 0C19 14.5 12 21 12 21Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  wallet:
    "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6a2 2 0 0 1-2-2Zm13 7h.01",
  qrcode:
    "M4 4h5v5H4V4Zm11 0h5v5h-5V4ZM4 15h5v5H4v-5Zm11 2h2m-2 3h5v-5h-3m-9-2v5m7-9h-2v2m2-2v-2h2",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 0 8 7 8-7",
  phone:
    "M5.5 3h3l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5L15.5 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3.5 5a2 2 0 0 1 2-2Z",
  store:
    "M3 7l1.5-4h15L21 7M3 7v12a1 1 0 0 0 1 1h3v-7h10v7h3a1 1 0 0 0 1-1V7M3 7h18",
  play: "M6 4.5v15l14-7.5-14-7.5Z",
};

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

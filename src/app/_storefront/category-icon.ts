import type { IconName } from "./Icon";

// Categories are free-text, tenant-entered strings (CSV import — see
// product-csv-contract.ts), not a fixed taxonomy, so there is no real
// per-category icon field to read. This is a presentation-only keyword
// match, not a data source: a category whose name doesn't match any
// keyword below falls back to the generic "tag" icon rather than showing
// nothing or guessing.
const KEYWORD_ICON: Array<[RegExp, IconName]> = [
  [/đèn|ánh sáng|light/i, "lightbulb"],
  [/đồ chơi|board game|game/i, "gamepad"],
  [/mô hình|decor/i, "box"],
  [/móc khóa|quà/i, "gift"],
  [/bàn làm việc|văn phòng|desk/i, "briefcase"],
  [/công nghệ|phụ kiện công nghệ|cáp|sạc|cable|tech/i, "cable"],
  [/trang sức|jewelry|gem/i, "gem"],
];

export function iconForCategory(categoryName: string): IconName {
  for (const [pattern, icon] of KEYWORD_ICON) {
    if (pattern.test(categoryName)) return icon;
  }
  return "tag";
}

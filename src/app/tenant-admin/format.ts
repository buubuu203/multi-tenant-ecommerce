// Shared by the Catalog and Orders sections (both display VND prices).
export function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

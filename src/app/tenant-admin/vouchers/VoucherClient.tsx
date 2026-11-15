"use client";

import { useActionState, useState } from "react";
import { createVoucherAction, updateVoucherAction, deleteVoucherAction } from "./actions";
import {
  adminInputClassName,
  adminLabelClassName,
  adminButtonPrimaryClassName,
  adminButtonSecondaryClassName,
  adminButtonDangerClassName,
} from "../styles";
import { DateTimePicker } from "@/components/DateTimePicker";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

function formatDateForInput(date: Date | null): string {
  if (!date) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

type ProductOption = { id: string; name: string };

type VoucherData = {
  id: string;
  triggerType: string;
  code: string | null;
  label: string | null;
  discountType: string;
  discountValue: number;
  scope: string;
  products: { productId: string }[];
  minOrderAmount: number | null;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  enabled: boolean;
  createdAt: Date;
};

function ProductPicker({
  products,
  selectedIds,
  onChange,
}: {
  products: ProductOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products…"
        className={adminInputClassName}
      />
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No products found</p>
        ) : (
          filtered.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(p.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange([...selectedIds, p.id]);
                  } else {
                    onChange(selectedIds.filter((id) => id !== p.id));
                  }
                }}
                className="size-3.5 rounded border-border"
              />
              <span className="truncate">{p.name}</span>
            </label>
          ))
        )}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-xs text-muted-foreground">{selectedIds.length} product(s) selected</p>
      )}
    </div>
  );
}

function VoucherFormFields({
  defaults,
  products,
}: {
  defaults?: VoucherData;
  products: ProductOption[];
}) {
  const [triggerType, setTriggerType] = useState(defaults?.triggerType ?? "code");
  const [discountType, setDiscountType] = useState(defaults?.discountType ?? "percentage");
  const [scope, setScope] = useState(defaults?.scope ?? "order");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    defaults?.products.map((p) => p.productId) ?? [],
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Promotion type</span>
        <input type="hidden" name="triggerType" value={triggerType} />
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              checked={triggerType === "code"}
              onChange={() => setTriggerType("code")}
              className="size-3.5"
            />
            Coupon code
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              checked={triggerType === "automatic"}
              onChange={() => setTriggerType("automatic")}
              className="size-3.5"
            />
            Automatic
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {triggerType === "code" ? (
          <label className={adminLabelClassName}>
            Code
            <input
              name="code"
              defaultValue={defaults?.code ?? ""}
              placeholder="e.g. SALE10"
              required
              className={`${adminInputClassName} uppercase`}
            />
          </label>
        ) : (
          <label className={adminLabelClassName}>
            Label (shown to customer)
            <input
              name="label"
              defaultValue={defaults?.label ?? ""}
              placeholder="e.g. Free shipping over 500K"
              required
              className={adminInputClassName}
            />
          </label>
        )}
        <label className={adminLabelClassName}>
          Type
          <select
            name="discountType"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
            className={adminInputClassName}
          >
            <option value="percentage">Percentage (%)</option>
            <option value="fixed_amount">Fixed amount (₫)</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Scope</span>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="scope"
              value="order"
              checked={scope === "order"}
              onChange={() => setScope("order")}
              className="size-3.5"
            />
            Whole order
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="scope"
              value="product"
              checked={scope === "product"}
              onChange={() => setScope("product")}
              className="size-3.5"
            />
            Specific products
          </label>
        </div>
      </div>

      {scope === "product" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Target products</span>
          <ProductPicker
            products={products}
            selectedIds={selectedProductIds}
            onChange={setSelectedProductIds}
          />
          {selectedProductIds.map((id) => (
            <input key={id} type="hidden" name="productIds" value={id} />
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={adminLabelClassName}>
          {discountType === "percentage" ? "Percent off" : "Amount (₫)"}
          <input
            name="discountValue"
            type="number"
            min={1}
            max={discountType === "percentage" ? 100 : undefined}
            defaultValue={defaults?.discountValue ?? ""}
            required
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Min order amount
          <input
            name="minOrderAmount"
            type="number"
            min={0}
            defaultValue={defaults?.minOrderAmount ?? ""}
            placeholder="Optional"
            className={adminInputClassName}
          />
        </label>
        {discountType === "percentage" && (
          <label className={adminLabelClassName}>
            Max discount (₫)
            <input
              name="maxDiscount"
              type="number"
              min={0}
              defaultValue={defaults?.maxDiscount ?? ""}
              placeholder="Optional cap"
              className={adminInputClassName}
            />
          </label>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={adminLabelClassName}>
          Max uses
          <input
            name="maxUses"
            type="number"
            min={1}
            defaultValue={defaults?.maxUses ?? ""}
            placeholder="Unlimited"
            className={adminInputClassName}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Starts at</span>
          <DateTimePicker
            name="startsAt"
            defaultValue={defaults?.startsAt ?? null}
            placeholder="Optional"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Ends at</span>
          <DateTimePicker
            name="endsAt"
            defaultValue={defaults?.endsAt ?? null}
            placeholder="Optional"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={defaults?.enabled ?? true}
          className="size-4 rounded border-border"
        />
        Enabled
      </label>
    </>
  );
}

export function VoucherForm({ products }: { products: ProductOption[] }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => createVoucherAction(formData),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <VoucherFormFields products={products} />
      <div>
        <button type="submit" disabled={pending} className={adminButtonPrimaryClassName}>
          {pending ? "Creating…" : "Create voucher"}
        </button>
      </div>
      {state && !state.success && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}

export function VoucherRow({ voucher, products }: { voucher: VoucherData; products: ProductOption[] }) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await updateVoucherAction(voucher.id, formData);
      if (result.success) setEditing(false);
      return result;
    },
    null,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    async (_prev: unknown) => deleteVoucherAction(voucher.id),
    null,
  );

  const now = new Date();
  const isActive =
    voucher.enabled &&
    (!voucher.startsAt || now >= voucher.startsAt) &&
    (!voucher.endsAt || now <= voucher.endsAt) &&
    (voucher.maxUses === null || voucher.usedCount < voucher.maxUses);

  const targetedProductNames = voucher.products
    .map((vp) => products.find((p) => p.id === vp.productId)?.name)
    .filter(Boolean);

  if (editing) {
    return (
      <div className="p-5 sm:p-6">
        <form action={updateAction} className="flex flex-col gap-4">
          <VoucherFormFields defaults={voucher} products={products} />
          <div className="flex gap-2">
            <button type="submit" disabled={updatePending} className={adminButtonPrimaryClassName}>
              {updatePending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={adminButtonSecondaryClassName}>
              Cancel
            </button>
          </div>
          {updateState && !updateState.success && (
            <p className="text-sm text-red-600">{updateState.error}</p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">
            {voucher.triggerType === "automatic" ? (voucher.label ?? "Auto") : voucher.code}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              isActive
                ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                : "border-border bg-surface-muted text-muted-foreground"
            }`}
          >
            {isActive ? "Active" : "Inactive"}
          </span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">
            {voucher.triggerType === "automatic" ? "Auto" : "Code"}
          </span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">
            {voucher.scope === "product" ? "Product" : "Order"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {voucher.discountType === "percentage"
            ? `${voucher.discountValue}% off`
            : `${formatVnd(voucher.discountValue)} off`}
          {voucher.minOrderAmount ? ` · min ${formatVnd(voucher.minOrderAmount)}` : ""}
          {voucher.maxDiscount ? ` · max ${formatVnd(voucher.maxDiscount)}` : ""}
          {voucher.maxUses !== null ? ` · ${voucher.usedCount}/${voucher.maxUses} used` : ` · ${voucher.usedCount} used`}
          {voucher.endsAt ? ` · until ${voucher.endsAt.toLocaleDateString("vi-VN")}` : ""}
        </p>
        {targetedProductNames.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Applies to: {targetedProductNames.join(", ")}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(true)} className={adminButtonSecondaryClassName}>
          Edit
        </button>
        <form action={deleteAction}>
          <button type="submit" disabled={deletePending} className={adminButtonDangerClassName}>
            {deletePending ? "…" : "Delete"}
          </button>
        </form>
      </div>
      {deleteState && !deleteState.success && (
        <p className="w-full text-sm text-red-600">{deleteState.error}</p>
      )}
    </div>
  );
}

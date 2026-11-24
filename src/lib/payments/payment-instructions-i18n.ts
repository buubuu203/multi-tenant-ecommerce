import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { PaymentInstructions } from "./provider";

// Every PaymentProvider (cod, manual bank transfer, SePay VA, MoMo) used to
// return its `title`/`nextAction` as a literal, hardcoded ENGLISH string —
// these cross straight from server-side provider code into the checkout
// success panel and the order-lookup page, neither of which ever had a
// chance to translate them. Providers now return one of the stable codes
// below instead; translatePaymentInstructions() is the one place that
// turns a code into display text, in the caller's own locale.
export type PaymentTitleCode = "PAY_BANK_TRANSFER_TITLE";

export type PaymentNextActionCode =
  | "PAY_COD_ON_DELIVERY"
  | "PAY_BANK_TRANSFER_MANUAL_CREATED"
  | "PAY_BANK_TRANSFER_MANUAL_NOTE_ONLY"
  | "PAY_BANK_TRANSFER_NOT_CONFIGURED"
  | "PAY_BANK_TRANSFER_SCAN_QR"
  | "PAY_MOMO_REDIRECT"
  | "PAY_MOMO_SUCCEEDED"
  | "PAY_MOMO_PENDING_RETRY"
  | "PAY_MOMO_NOT_COMPLETED";

function translateTitle(code: string, dict: Dictionary): string {
  if (code === ("PAY_BANK_TRANSFER_TITLE" satisfies PaymentTitleCode)) {
    return dict.payment.transferToTitle;
  }
  return code; // Unknown code: show it verbatim rather than silently nothing.
}

function translateNextAction(code: string, dict: Dictionary): string {
  switch (code as PaymentNextActionCode) {
    case "PAY_COD_ON_DELIVERY":
      return dict.payment.codHint;
    case "PAY_BANK_TRANSFER_MANUAL_CREATED":
      return dict.payment.manualTransferCreatedHint;
    case "PAY_BANK_TRANSFER_MANUAL_NOTE_ONLY":
      return dict.payment.manualTransferNoteHint;
    case "PAY_BANK_TRANSFER_NOT_CONFIGURED":
      return dict.payment.contactStoreHint;
    case "PAY_BANK_TRANSFER_SCAN_QR":
      return dict.payment.scanQrHint;
    case "PAY_MOMO_REDIRECT":
      return dict.payment.momoRedirectHint;
    case "PAY_MOMO_SUCCEEDED":
      return dict.payment.momoSucceededHint;
    case "PAY_MOMO_PENDING_RETRY":
      return dict.payment.momoPendingRetryHint;
    case "PAY_MOMO_NOT_COMPLETED":
      return dict.payment.momoNotCompletedHint;
    default:
      return code; // Unknown code: show it verbatim rather than silently nothing.
  }
}

/**
 * Returns a NEW PaymentInstructions with `title`/`nextAction` translated
 * from their stable codes into the caller's locale — called once, right
 * before rendering, by every UI that shows these instructions (the
 * checkout success panel in CartWidget.tsx, and the order-lookup page in
 * OrderLookupForm.tsx). Every other field (bank details, QR url, amount,
 * expiry) passes through unchanged; those were never English-only text.
 */
export function translatePaymentInstructions(
  instructions: PaymentInstructions,
  dict: Dictionary,
): PaymentInstructions {
  if (instructions.type === "bank_transfer") {
    return {
      ...instructions,
      title: translateTitle(instructions.title, dict),
      nextAction: translateNextAction(instructions.nextAction, dict),
    };
  }
  return { ...instructions, nextAction: translateNextAction(instructions.nextAction, dict) };
}

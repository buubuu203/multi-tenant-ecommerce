'use client';

import { useState } from 'react';
import { sendTestTelegramNotificationAction } from './actions';

// Separate client component rather than folding this into the branding
// page's <ActionForm> (page.tsx is a server component, and this needs its
// own independent pending/result state that must NOT submit or revalidate
// the surrounding form) — same posture as BrandingUploadControls's own
// upload buttons.
export function TelegramTestButton() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleClick() {
    setSending(true);
    setMessage(null);
    const result = await sendTestTelegramNotificationAction();
    setSending(false);
    setMessage(
      result.success
        ? { ok: true, text: 'Đã gửi tin nhắn thử. Kiểm tra Telegram của bạn.' }
        : { ok: false, text: result.error },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface disabled:opacity-50"
      >
        {sending ? 'Đang gửi…' : 'Gửi thử'}
      </button>
      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
      )}
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { Prisma } from '@/generated/prisma/client';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTICE_LENGTH = 20_000;

export type PrivacyErrorCode = keyof Dictionary['privacy']['errors'];
export type PrivacyActionResult<T> =
  { success: true; data: T } | { success: false; error: PrivacyErrorCode };

export type PrivacyNoticeInput = {
  controllerName: string;
  contactEmail: string;
  noticeTextVi: string;
  noticeTextEn: string;
};

export function validatePrivacyNoticeInput(
  input: PrivacyNoticeInput,
): PrivacyActionResult<PrivacyNoticeInput> {
  const controllerName = input.controllerName.trim();
  const contactEmail = input.contactEmail.trim();
  const noticeTextVi = input.noticeTextVi.trim();
  const noticeTextEn = input.noticeTextEn.trim();

  if (!controllerName || controllerName.length > 200) {
    return { success: false, error: 'controllerNameInvalid' };
  }
  if (!EMAIL_PATTERN.test(contactEmail) || contactEmail.length > 254) {
    return { success: false, error: 'contactEmailInvalid' };
  }
  if (
    [noticeTextVi, noticeTextEn].some(
      (noticeText) => noticeText.length < 30 || noticeText.length > MAX_NOTICE_LENGTH,
    )
  ) {
    return { success: false, error: 'noticeLengthInvalid' };
  }

  return { success: true, data: { controllerName, contactEmail, noticeTextVi, noticeTextEn } };
}

export function parseRequestReceivedDate(
  value: string,
  now = new Date(),
): PrivacyActionResult<Date> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { success: false, error: 'requestDateRequired' };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { success: false, error: 'requestDateInvalid' };
  }
  if (date.getTime() > now.getTime()) {
    return { success: false, error: 'requestDateFuture' };
  }
  return { success: true, data: date };
}

export function isCurrentPrivacyNoticeVersion(
  currentId: string | null,
  submittedId: string | null | undefined,
): boolean {
  return Boolean(currentId && submittedId && currentId === submittedId);
}

export async function getCurrentPrivacyNotice(tenantId: string) {
  if (!tenantId.trim()) return null;
  return prisma.privacyNoticeVersion.findFirst({
    where: { tenantId, isCurrent: true },
    select: {
      id: true,
      version: true,
      controllerName: true,
      contactEmail: true,
      noticeTextVi: true,
      noticeTextEn: true,
      publishedAt: true,
    },
  });
}

export async function listPrivacyNoticeVersions(tenantId: string) {
  return prisma.privacyNoticeVersion.findMany({
    where: { tenantId },
    orderBy: { version: 'desc' },
    take: 10,
    select: { id: true, version: true, isCurrent: true, publishedAt: true },
  });
}

export async function publishPrivacyNotice(
  tenantId: string,
  actorId: string,
  input: PrivacyNoticeInput,
): Promise<PrivacyActionResult<{ version: number }>> {
  const validated = validatePrivacyNoticeInput(input);
  if (!validated.success) return validated;
  if (!tenantId.trim() || !actorId.trim()) {
    return { success: false, error: 'adminIdentityInvalid' };
  }

  try {
    const version = await prisma.$transaction(async (tx) => {
      const latest = await tx.privacyNoticeVersion.findFirst({
        where: { tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.privacyNoticeVersion.updateMany({
        where: { tenantId, isCurrent: true },
        data: { isCurrent: false },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      await tx.privacyNoticeVersion.create({
        data: {
          tenantId,
          version: nextVersion,
          ...validated.data,
          publishedBy: actorId,
          isCurrent: true,
        },
      });
      return nextVersion;
    });

    return { success: true, data: { version } };
  } catch (error) {
    console.error('publishPrivacyNotice failed:', error);
    return { success: false, error: 'publishFailed' };
  }
}

export async function anonymizeCustomer(
  tenantId: string,
  customerId: string,
  actorId: string,
  requestReceivedAt: Date,
): Promise<PrivacyActionResult<{ affectedOrderCount: number }>> {
  if (!tenantId.trim() || !customerId.trim() || !actorId.trim()) {
    return { success: false, error: 'adminIdentityInvalid' };
  }
  if (Number.isNaN(requestReceivedAt.getTime()) || requestReceivedAt.getTime() > Date.now()) {
    return { success: false, error: 'requestDateInvalid' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, anonymizedAt: true },
      });
      if (!customer) return { success: false, error: 'customerNotFound' } as const;
      if (customer.anonymizedAt) {
        return { success: false, error: 'customerAlreadyAnonymized' } as const;
      }

      const orders = await tx.order.findMany({
        where: { tenantId, customerId },
        select: { id: true },
      });
      const orderIds = orders.map(({ id }) => id);
      const payments = orderIds.length
        ? await tx.payment.findMany({
            where: { tenantId, orderId: { in: orderIds } },
            select: { id: true },
          })
        : [];
      const paymentIds = payments.map(({ id }) => id);

      const anonymized = await tx.customer.updateMany({
        where: { id: customerId, tenantId, anonymizedAt: null },
        data: {
          email: `erased+${customerId}@privacy.invalid`,
          name: 'Deleted customer',
          phone: '',
          anonymizedAt: new Date(),
        },
      });
      if (anonymized.count !== 1) {
        return { success: false, error: 'customerAlreadyAnonymized' } as const;
      }
      if (orderIds.length > 0) {
        await tx.order.updateMany({
          where: { tenantId, id: { in: orderIds } },
          data: {
            shippingAddress: '[redacted]',
            shippingWard: '[redacted]',
            shippingDistrict: '[redacted]',
            shippingCity: '[redacted]',
            shippingNote: null,
          },
        });
      }
      if (paymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { tenantId, id: { in: paymentIds } },
          data: { providerMetadata: Prisma.DbNull },
        });
        await tx.paymentEvent.updateMany({
          where: { paymentId: { in: paymentIds } },
          data: { rawPayload: { redacted: true } },
        });
      }
      await tx.customerPrivacyEvent.create({
        data: {
          tenantId,
          customerId,
          actorId,
          requestReceivedAt,
          affectedOrderCount: orderIds.length,
        },
      });

      return { success: true, data: { affectedOrderCount: orderIds.length } } as const;
    });

    return result;
  } catch (error) {
    console.error('anonymizeCustomer failed:', error);
    return { success: false, error: 'anonymizeFailed' };
  }
}

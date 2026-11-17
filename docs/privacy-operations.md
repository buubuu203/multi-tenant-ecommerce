# Privacy operations

This application provides privacy-related controls; it does not certify a
tenant's legal compliance. Have qualified Vietnamese counsel review each
tenant's notice, purposes, retention schedule and operational procedures
before accepting customer data.

## What the application does

- Each tenant can publish versioned controller/contact details and
  separate Vietnamese and English notice text at `/tenant-admin/privacy`.
- The public `/privacy` page displays the notice in the visitor's selected
  language and only shows that tenant's current version.
- Storefront checkout is blocked unless a current notice exists and the
  customer checks the explicit order-processing consent box. The form
  links to the notice before collecting contact and delivery data. Both
  language versions are required before checkout can be enabled.
- New orders record the notice version shown, when it was made available,
  and a separate server timestamp for the affirmative consent. The
  customer-detail view exposes this order-level record. It does not prove
  that the customer opened or read the notice, or consent to unrelated
  purposes; legal counsel must confirm the wording and basis are appropriate.
- An authorized tenant admin can anonymize a customer after verifying the
  requester and reviewing retention requirements. The action records the
  admin, received date, completion time and affected order count; it
  removes direct contact/address data and redacts payment-provider
  metadata and webhook payloads while retaining order/payment facts.

No notice text or privacy contact is pre-filled: each tenant must supply
accurate, legally reviewed details in both languages. The required
checkbox is worded narrowly for processing data to receive and fulfill the
order; it is not bundled consent for marketing, unrelated analytics or
other optional purposes. Processing necessary to perform a purchase
contract may have a different legal basis from those optional purposes.
Counsel should confirm that requesting explicit consent for the order flow
is appropriate for the tenant's actual processing and notice.

## Operator duties not automated here

Tenants must maintain a lawful retention schedule; assess and respond to
requests within the applicable periods; review whether transaction records
must be retained before anonymizing; and handle copies held by backups,
payment providers, delivery providers and other processors. The
application does not file cross-border transfer assessments, send breach
notifications, manage request deadlines, or verify that the published
notice is legally sufficient. Do not promise complete erasure from
third-party or backup systems based on the admin action.

## Legal references reviewed

The deck's slide 27 is a summary, not a substitute for the applicable
texts. The review used these official sources:

- [Law 91/2025/QH15 on Personal Data Protection](https://vanban.chinhphu.vn/?pageid=27160&docid=214590&classid=1&typegroupid=3), effective 1 January 2026. Article 19(1)(d) addresses processing necessary to perform a contract as a case where consent may not be required; it is not blanket permission for unrelated uses or indefinite retention.
- [Decree 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?pageid=27160&docid=216387), effective 1 January 2026, implementing the Law and repealing Decree 13/2023/NĐ-CP. Article 5(4) provides a 2-working-day response period and generally a 20-day action period for deletion requests; the text also provides for justified extensions and a 30-day period for processor/third-party action.
- [Decree 330/2026/NĐ-CP](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-330-2026-nd-cp-470339.htm), on administrative sanctions. Do not rely on simplified fine figures in slide 27 without checking the applicable provision and facts.

The deck's breach-notification and cross-border-transfer summaries are
also broad; determine the applicable trigger and scope from the statutory
text and the actual processing arrangement.

Before deploying, review and apply the additive migration
`20261119120000_add_privacy_controls` through the repository's normal
release process. It is intentionally not applied to any hosted database
by this change.

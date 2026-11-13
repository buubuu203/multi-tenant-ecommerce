# Behavioural analytics — plan, not implementation

**Nothing in this document is built.** It is the design that has to be
agreed before any of it is, because the first line of code here starts
collecting data about people who have not been asked.

Requested after Preview QA: a view → add-to-cart → buy funnel, and
product view counts. The trend chart now on Overview is **not** this: it
counts orders the store already has. This document covers what would be
needed to count what shoppers _do_, which the application does not
record at all today.

## What exists today, and what does not

| Fact                                      | Recorded?                                               |
| ----------------------------------------- | ------------------------------------------------------- |
| Order placed, its items, prices, totals   | **Yes** — `Order`, `OrderItem`                          |
| Order status changes, with actor and time | **Yes** — `OrderEvent`                                  |
| Payment opened, confirmed, refused        | **Yes** — `Payment`, `PaymentEvent`, `PaymentRejection` |
| Stock reserved, consumed, released        | **Yes** — `Inventory`                                   |
| **Product page viewed**                   | **No**                                                  |
| **Item added to cart**                    | **No** — the cart is client state only                  |
| **Checkout started and abandoned**        | **No**                                                  |
| **Visitor or session identity**           | **No**                                                  |
| **Traffic source**                        | **No**                                                  |
| **Consent to be measured**                | **No** — `Customer` has no consent field                |

So the funnel's first two stages do not exist, and neither does the
notion of a person to attribute them to.

## The constraint this lifts

The operational analytics phase was built under an explicit instruction:

> Do not add tracking pixels, cookies, session recording, or marketing
> attribution.

That is why `/tenant-admin/analytics` reports only stored commercial
facts. Building a funnel reverses that decision. It should be reversed
deliberately and in writing, not absorbed into a UI ticket.

## What a funnel actually requires

### 1. A visitor identifier

A funnel needs to know that the same person viewed, then added, then
bought. That means an identifier that survives page navigation.

- A first-party cookie or `localStorage` id is the usual answer. Under
  Vietnamese law (Decree 13/2023/ND-CP on personal data protection) a
  behavioural identifier tied to a person is personal data, and
  collecting it generally requires consent that is informed, specific
  and withdrawable.
- **A consent mechanism does not exist anywhere in this application.**
  Adding one is the prerequisite, not a follow-up.
- The alternative is counting events with **no** identifier: total views
  per product per day, with no path between stages. That needs no
  consent and no cookie, and it answers "which products get attention"
  but never "what fraction of viewers bought".

**This is the decision that shapes everything else.** Recommendation:
start with the no-identifier version, because it delivers the most
useful half of the request with none of the legal surface.

### 2. An event store that does not slow the storefront

A view event is written on a page a shopper is waiting for. Writing it
synchronously inside the render makes every product page slower.

- Fire-and-forget from the client after render, to a route that
  validates and appends.
- The table grows with traffic, unlike everything else in this schema.
  It needs a retention policy and pruning **from the first migration** —
  the payment-rejection pruning script is the pattern, and note that it
  is manual because this project has no scheduler.
- Aggregate per product per day on write or on a rollup, not by scanning
  raw events at read time.

### 3. Bot and self-traffic exclusion

Without it the numbers are wrong in a direction that flatters. The
merchant's own admin sessions, uptime checks and crawlers all look like
interest. This needs deciding before anyone reads a conversion rate.

### 4. Honest naming

The same discipline the rest of this codebase holds to:

- A view is a **page render**, not a person. One shopper reloading twice
  is two views.
- Add-to-cart is an **intent**, and the cart is client state that can be
  abandoned, cleared by the browser, or never reconciled.
- A conversion **rate** is a ratio of two things measured differently,
  one of which (views) is far noisier than the other (orders). It must
  carry that caveat wherever it is shown.

## Proposed phasing

| Phase                    | Delivers                                                                   | Needs consent? | Needs a migration?                      |
| ------------------------ | -------------------------------------------------------------------------- | -------------- | --------------------------------------- |
| **A. Product attention** | Views per product per day, aggregated. "Which products do people look at." | No             | Yes — one aggregate table               |
| **B. Cart intent**       | Add-to-cart events per product per day, unlinked to views.                 | No             | Extends A's table                       |
| **C. True funnel**       | View → cart → buy for the same visitor, with a conversion rate.            | **Yes**        | Visitor id, consent record, event store |
| **D. Attribution**       | Where traffic came from.                                                   | **Yes**        | Referrer capture, campaign params       |

A and B are honest, useful and legally quiet. C is where the real cost
is, and it should be a decision of its own.

## What must not happen

- No third-party analytics script. It would send shopper data to another
  company from a storefront whose operators have not agreed to that, and
  it would put a request to an external host in the critical path of
  every page.
- No session recording. Disproportionate for the question being asked.
- No funnel number presented without its denominator and its caveat.
- No conversion rate on Overview until bots are excluded.

## Decisions needed before any code

1. Identifier or no identifier — in other words, is Phase C in scope at
   all, or do we stop at B?
2. If C: who owns the consent design and its legal review?
3. Retention period for raw events, and who runs the pruning given there
   is no scheduler.
4. Whether admin and merchant traffic is excluded from day one.
5. Whether the funnel is per product, per variant, or store-wide.

Until 1 and 2 are answered, Phases A and B can proceed and Phase C
cannot.

# Taking payments with Paddle

PinPicX sells the Pro and Business plans as monthly or yearly subscriptions through [Paddle Billing](https://www.paddle.com/billing).
Paddle is the merchant of record: it runs the checkout, charges the customer, collects and pays sales tax and VAT,
sends receipts and invoices, and pays you out. PinPicX never sees card details.

How it fits together:

1. On **/pricing**, a signed-in user picks a plan. Paddle's checkout opens over the page, already filled in with their email and their PinPicX account ID.
2. After paying, Paddle sends them to **/account/billing**, and sends a signed webhook to **/api/paddle/webhook**.
3. The webhook saves the subscription and switches the account to that plan. The new API and upload limits apply immediately.
4. Every later change (renewal, upgrade, failed payment, cancellation) comes in the same way. When a subscription ends, the account goes back to Free.

People manage everything in **Account → Billing**:

- change plan, which Paddle prorates straight away
- cancel at the end of the paid period, or undo a cancellation
- update their card and download invoices, in Paddle's customer portal

Deleting an account cancels its subscription immediately.

Until Paddle is configured, the pricing page keeps working as before: the upgrade buttons send an email.

---

## 1. Start in the sandbox

Create a free sandbox account at **https://sandbox-vendors.paddle.com/signup**. A sandbox is a full copy of Paddle where no real money moves. Do the whole setup there first, then repeat it in your live account.

## 2. Create the products and prices

Go to **Paddle → Catalog → Products → New product**.

| Product | Price | Billing period | Example |
|---|---|---|---|
| PinPicX Pro | Monthly | every 1 month | USD 2.99 |
| PinPicX Pro | Yearly | every 1 year | USD 32.89 (11 × monthly = "1 month free") |
| PinPicX Business | Monthly | every 1 month | USD 14.99 |
| PinPicX Business | Yearly | every 1 year | USD 164.89 |

- Use **one currency for all four prices**. USD is the simplest choice.
- **Sri Lankan rupees (LKR) can't be charged through Paddle.** Paddle charges customers in Sri Lanka in USD. Visitors can still *view* prices in LKR and other currencies with the currency selector on /pricing.
- If you'd like customers in some countries to pay in their own currency (INR, EUR, GBP, …), add **country-specific prices** to each price in Paddle. Checkout then charges those amounts, and the pricing page notes that checkout shows the exact amount before payment.
- The pricing page reads the amounts from Paddle, so you only set prices in one place. If you leave out the yearly prices, the Yearly option disappears. The Yearly label works out the saving from the prices: 11 × monthly shows "1 month free", 10 × monthly "2 months free", and anything else the percentage (for example "Save 20%").
- Copy each price ID (`pri_…`).

## 3. Get the keys

**Paddle → Developer tools → Authentication**:

- **Client-side token** (starts with `test_` in the sandbox). The browser uses it to open checkout, and it's safe to expose.
- **API key** (starts with `pdl_sdbx_apikey_` in the sandbox). Give it these permissions:
  - Prices: read
  - Subscriptions: read and write
  - Customers: read
  - Customer portal sessions: write

  Keep the API key secret.

## 4. Set the default payment link

**Paddle → Checkout → Checkout settings → Default payment link**: `https://yoursite.com/pricing`.
Paddle requires this before checkouts open. It's also where links in Paddle's emails take people.

## 5. Add the webhook

**Paddle → Developer tools → Notifications → New destination**:

- **URL:** `https://yoursite.com/api/paddle/webhook`
- **Events:** all `subscription.*` events: created, activated, updated, trialing, past_due, paused, resumed, canceled, imported

Save it, then copy the destination's **secret key** (starts with `pdl_ntfset_`).

## 6. Set the variables in Railway

On the **web** service, under **Variables**:

```env
PADDLE_ENV=sandbox
PADDLE_CLIENT_TOKEN=test_...
PADDLE_API_KEY=pdl_sdbx_apikey_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
PADDLE_PRICE_PRO_MONTHLY=pri_...
PADDLE_PRICE_PRO_YEARLY=pri_...
PADDLE_PRICE_BUSINESS_MONTHLY=pri_...
PADDLE_PRICE_BUSINESS_YEARLY=pri_...

# Fallback prices, shown only if Paddle can't be reached. Keep them the same as in Paddle.
PRICE_CURRENCY=USD
PRO_PRICE=2.99
BUSINESS_PRICE=14.99
```

Redeploy. The database changes are applied automatically when the app starts.

## 7. Test it

1. Sign in with a normal (non-admin) account and open **/pricing**. The buttons now say **Upgrade to Pro** and **Upgrade to Business**.
2. Choose one. In Paddle's checkout, pay with the test card `4242 4242 4242 4242`, any future expiry date and any name. To test a failed payment, use `4000 0000 0000 0002`. Paddle lists more [test cards](https://developer.paddle.com/build/tools/sandbox).
3. You land on **Account → Billing**. Within a few seconds it shows your new plan, its price and the renewal date. API keys shows the new limits.
4. Try **Change plan** (switch between Pro and Business, or monthly and yearly), **Cancel subscription**, **Keep my subscription**, and **Payment method and invoices**.
5. In **Paddle → Notifications**, every delivery should show a 200 response. If one doesn't, check the logs in Railway for lines starting with `[paddle]`.

## 8. Go live

1. **Paddle verifies your business and your website before you can take real payments.** In your live account, complete **Business verification** and **Website approval** for your domain.
   - Paddle's reviewers check that your site has a pricing page, terms of service, a privacy policy and a refund policy.
     PinPicX has all four (**/pricing**, **/terms**, **/privacy**, **/refunds**), and the terms already say that Paddle is your reseller and Merchant of Record.
     Read them and adjust them to your business first; in particular, set `REFUND_DAYS` (default 14) to the refund window you'll honour.
   - Check that image hosting with user uploads is acceptable under Paddle's policy for your business. Strong abuse reporting and moderation (which PinPicX has) helps.
2. Repeat steps 2–5 in the live account. Live products, keys and webhook secrets are different from the sandbox ones.
3. Change the variables to the live values and set `PADDLE_ENV=production`. Live keys start with `live_` and `pdl_live_apikey_`.

## Good to know

- **Who decides the plan:** the webhook keeps `users.plan` in line with the account's subscriptions. Its best active subscription wins, and with none the account is on Free. A plan you set by hand under **Moderation → Users** stays, until that account's next Paddle event replaces it. Paying accounts are marked "Paid via Paddle" there.
- **Failed renewals** (`past_due`): the account keeps its plan while Paddle retries the payment for a few days. Billing asks the customer to update their card. If Paddle gives up, the subscription is cancelled and the account moves to Free.
- **Duplicates and order:** each webhook event is processed once, and an older update never overwrites a newer one.
- **Giving a refund:** in Paddle, open the transaction and choose **Refund**. A refund doesn't end the subscription by itself, so if the customer is leaving, also open the subscription and **Cancel → Immediately**. The webhook then moves the account to Free.
- **Adding a price later** (a discount plan, say) without a new variable: give the price custom data `{"plan": "pro"}` or `{"plan": "business"}` in Paddle, and the webhook will recognise it.
- **Local development:** checkout opens on `localhost` with sandbox tokens. Webhooks need a public URL, so use a tunnel (for example `cloudflared tunnel --url http://localhost:3000`) and point a sandbox notification destination at it.

Paddle documentation:
- [Overlay checkout](https://developer.paddle.com/build/checkout/build-overlay-checkout)
- [Webhook signatures](https://developer.paddle.com/webhooks/signature-verification)
- [Upgrades and downgrades](https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade)
- [Cancellations](https://developer.paddle.com/build/subscriptions/cancel-subscriptions)
- [Customer portal](https://developer.paddle.com/build/customers/integrate-customer-portal)

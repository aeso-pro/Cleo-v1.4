# Plan payments: how they work and how to switch them on

Cleo's plans (Basic, Pro, Max) are paid through **PayMongo**, on PayMongo's own checkout page. Free starts with no payment. Enterprise stays "Talk to sales".

The code is finished and tested against a stand-in provider. **No real money can move until you do the steps in section 2**, because they need a PayMongo account and keys that only you may hold.

## 1. What happens when an owner pays

1. The owner picks a plan, the number of terminals, monthly or annual, and how to pay: card, GCash, Maya or GoTyme Bank.
2. Cleo's server works out the price from its own price list. A price sent by a browser is never used.
3. The owner is sent to PayMongo's checkout page for that amount and pays there. Card and wallet details never pass through Cleo.
4. PayMongo tells Cleo's server the payment was made. The server checks the message's signature, then asks PayMongo directly whether it is true. Only then is the plan switched on.
5. The owner lands back in Cleo, which opens the modes the plan includes.

If the owner cancels, nothing is charged and they are back on the payment page. If PayMongo's message is delayed or lost, Cleo asks PayMongo itself when the owner returns, so the plan still starts.

| Chosen in Cleo | Paid on PayMongo with |
| --- | --- |
| Credit or debit card | `card` |
| GCash | `gcash` |
| Maya | `paymaya` |
| GoTyme Bank | `qrph` (the owner scans a QR Ph code with the GoTyme app) |

## 2. Switching it on

Start in **test mode**. PayMongo's test keys move no money, and you can go live later by repeating steps 3 and 5 with the live keys.

1. **Open a PayMongo account** at paymongo.com. Test keys are available at once; live keys need PayMongo to verify your business.
2. **Database: done.** Migration 006 was applied to the hosted project on 2026-11-17, with 002 to 005 and 007. 008 (plan limits, branches, staff, terminals, sales) on 2026-11-18.
3. **Add three secrets** in Supabase › Edge Functions › Secrets. Paste them there yourself; never into a file, a chat or the app.

   | Name | Value |
   | --- | --- |
   | `PAYMONGO_SECRET_KEY` | PayMongo › Developers › API keys: the **secret** key (`sk_test_…`, later `sk_live_…`) |
   | `PAYMONGO_WEBHOOK_SECRET` | From step 5 (`whsk_…`) |
   | `CLEO_APP_URL` | The address Cleo is served from, for example `https://cleopos.online` |

4. **Deploy the two functions** from the project folder (needs the Supabase CLI, signed in to your account):

   ```bash
   supabase functions deploy billing
   ```

   ```bash
   supabase functions deploy billing-webhook --no-verify-jwt
   ```

5. **Register the webhook in PayMongo** (Developers › Webhooks): URL `https://ntbkbvlsgymupjdpuvob.supabase.co/functions/v1/billing-webhook`, event `checkout_session.payment.paid`. PayMongo shows a signing secret once; that is `PAYMONGO_WEBHOOK_SECRET`.
6. **Try it.** Sign in to Cleo as an owner, choose a plan and pay with one of PayMongo's test cards or test wallets. Cleo should come back with "Payment received" and open.

Check with PayMongo that every method you want (GCash, Maya, QR Ph) is enabled on your account; some need activating.

## 3. What a subscription is, for now

- **One payment buys one period**: a month or a year. Nothing renews by itself and no card is kept. The owner pays again from Plan and billing before the period ends.
- Paying again for the same plan **adds** a period to the days left. Switching plan starts the new period at once.
- A paid plan stays open for **3 days** after its period ends. After that the app returns to the plan page until it is paid; the business's data is untouched.
- Prices live in the database table `cleo_plan_prices` and match `content/plans.md`. Change both together, with a new migration.

## 4. Where the code is

| File | What it does |
| --- | --- |
| `supabase/migrations/202611150006_billing.sql` | Price list, payments, subscriptions, and the functions that start and settle a payment |
| `supabase/functions/_shared/billing-core.js` | The logic: open a checkout, check a webhook, settle |
| `supabase/functions/billing/index.ts` | Called by the signed-in owner: start a checkout, or check a payment on return |
| `supabase/functions/billing-webhook/index.ts` | Called by PayMongo |
| `index.html`, `backend/supabase.js` section | `subscribe`, `addCard`, `linkWallet` and the return from the provider's page |

Tests: `npm --prefix supabase/tests test` (8 billing checks among 71), and `node supabase/tests/e2e-server.mjs`, which runs the same function logic against a stand-in PayMongo at `/__paymongo` so a whole purchase can be clicked through at `http://localhost:5180/`.

## 5. Plan limits

Enforced on the server since migration 008: the terminals and branches a subscription pays for, Free's 100 products and one cashier, and each plan's features (see `cleo_features()` and `Docs/FRONTEND_BACKEND_HANDOFF.md`, 2026-11-18). A business with no plan in force reads its data but changes nothing until it chooses one.

## 6. Not built yet

- **Automatic renewal** and saved cards or linked wallets. PayMongo's subscription product is a separate integration.
- **Invoices and receipts inside Cleo.** PayMongo emails a receipt; Plan and billing lists none yet.
- **Refunds** are made in PayMongo's dashboard and do not change the plan in Cleo.
- **VAT and BIR treatment** of the subscription itself is still to be confirmed with an accountant.
- The real PayMongo was not exercised from here: that needs your account. The signature check follows PayMongo's published format (`t=…,te=…,li=…`); confirm it with a test event in step 6.

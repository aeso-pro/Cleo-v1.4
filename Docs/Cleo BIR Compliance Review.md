# Cleo BIR Compliance Review

13 October 2026 · Front end (`Frontend/source`, built to `Frontend/index.html`)

This review checks Cleo against the BIR rules for POS systems and lists what was added for launch. It also lists what the backend, Aeso and each client still need to do. It is a working document for the team, not legal advice. Have a tax adviser confirm the items under "To confirm" before the accreditation application.

## Summary

- **Before this review:** Cleo already had an invoice series, X- and Z-readings, an electronic journal screen, SC/PWD/NAAC/Solo Parent sales books and an audit trail. Most of these were static demo screens. The receipt also lacked several fields that RR 7-2024 and RMO 24-2023 require.
- **What changed:**
  - Every document the Terminal prints is now numbered from its own series and kept in an electronic journal.
  - Each terminal keeps a fiscal memory: series numbers, accumulated grand total, Z counter and reset counter.
  - The Back Office readings, sales books and the new backend reports read from that journal.
- **What remains:**
  - Aeso's accreditation under RMO 24-2023, and a PTU for each client terminal.
  - Server storage of the journal (5-year retention).
  - The items under "To confirm".

## Rules checked

| Rule | What it governs |
| --- | --- |
| RR No. 7-2024, as amended by RR No. 11-2024 (EOPT Act invoicing) | "Invoice" replaces "Official Receipt"; required invoice fields; buyer details; supplementary documents; retention |
| RMC No. 77-2024 (sample invoices) | Layout of the VAT and non-VAT invoice, including the totals block and the VAT breakdown box |
| RMO No. 24-2023 (accreditation of POS, CRM and invoicing software) | Required system features, X- and Z-reading content, the invoice header and footer, backend reports |
| RR No. 11-2004 | Rules on cash register and POS machines (MIN, PTU, per-machine registration) |
| RA 9994, RA 10754 | Senior citizen and PWD: 20% discount plus VAT exemption |
| RA 10699 (RR No. 13-2020) | National athletes and coaches: 20% discount |
| RA 9049 | Medal of Valor awardees and dependants: 20% discount |
| RA 11861 (RR No. 1-2023) | Solo parents: 10% discount plus VAT exemption on baby items for a child 6 or under |

## Requirements and status

"Added" means it was built in this review. "Existing" means it was already there and was checked.

### Invoice (RR 7-2024, RMC 77-2024)

| Requirement | Status | Where |
| --- | --- | --- |
| Titled "Sales Invoice" (or "Invoice", "Service Invoice"), never "Official Receipt" | Added | Back Office › Settings › Business › Invoices |
| Registered name, trade name, business style, branch address, "VAT REG TIN" with the 5-digit branch code | Added | `Cleo.bir.seller`, `tin` |
| MIN and serial number at the top; PTU number and date at the bottom | Added | `Cleo.bir.machine` |
| Software supplier's name, address, TIN, accreditation number, date issued and valid until | Added (the accreditation is pending) | `SUPPLIER` in `bir.js` |
| 8-digit serial invoice number, date and time, cashier, terminal; cash or charge sale | Added | Invoice header |
| Quantity, unit price and amount per line; options; promos and service charge as separate lines | Added | Invoice lines |
| Totals block: Total sales (VAT inclusive), Less VAT, Amount net of VAT, Less discount, Add VAT, TOTAL AMOUNT DUE | Added | Matches the RMC 77-2024 sample |
| VAT breakdown: VATable, VAT, VAT-exempt and zero-rated sales | Added | Every invoice and reading |
| Buyer's name, TIN, address and business style for sales of ₱1,000 or more to VAT-registered buyers; the space printed on every invoice | Added | Payment › Add buyer (prompt at a configurable amount); company customers fill it in |
| Zero-rated sales (PEZA or BOI enterprises, embassies, international organizations), with a reference | Added | Buyer sheet |
| Non-VAT businesses and supplementary documents print "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX." | Added | Non-VAT invoices, voids, returns, payment receipts, bills |
| A copy marked "REPRINT", and each reprint logged | Added | RP series |

### Statutory discounts

| Requirement | Status | Where |
| --- | --- | --- |
| SC and PWD: 20% of the price net of VAT, plus VAT exemption | Existing, now reworked | `STATUTORY` in `bir.js` |
| NAAC and Medal of Valor: 20%, VAT still charged on the rest | Added (MOV is new) | Settings › Tax switches |
| Solo parent: 10% plus VAT exemption on qualifying baby items only; the cashier picks the items | Added | Statutory discount sheet |
| Name, ID number (and TIN if any) and signature line on the invoice | Added | Invoice footer |
| Shared meals: the discount covers only the share of the diners with an ID | Added | "Shared by the table" with people and ID counters |
| A sales book per discount type, with buyer ID | Existing, now from the journal; MOV added | Back Office › BIR and reports › Sales books |

### Adjustments

| Requirement | Status | Where |
| --- | --- | --- |
| Voids only before the Z-reading, with a reason and a manager; a void document that references the invoice | Added | Terminal › Shift › Void (VD series) |
| Returns and refunds issue a return document that references the invoice; the refund is what was paid, not the list price | Added | Terminal › Returns (RF series) |
| Voids and returns come off the VAT breakdown and appear on the readings | Added | `Cleo.bir.figures` |

### Readings and journal (RMO 24-2023)

| Requirement | Status | Where |
| --- | --- | --- |
| X-reading per cashier shift: sales, voids, returns, cash expected and counted | Existing, now from the journal | Terminal › Shift › Close shift |
| Z-reading per day: report date and time, start and end, Z counter, reset counter, beginning and ending invoice, void and return numbers, present and previous accumulated sales, sales for the day, breakdown, discount summary, sales and VAT adjustments, transaction summary | Added on the Terminal; Back Office reworked | Terminal › Shift › End of day |
| Accumulated grand total that never resets | Added | Fiscal memory |
| Electronic journal: a copy of every document, viewable and exportable | Existing screen, now real | Back Office › BIR and reports › E-journal (TXT export) |
| Backend reports: sales summary, voids, returns, reprints, discounts | Added | Back Office › BIR and reports › Backend reports |
| eSales monthly figures per machine | Added (template to confirm) | Backend reports › eSales |
| Activity log: user, time, activity, values | Existing | Back Office › Audit trail |

### Controls

| Requirement | Status | Where |
| --- | --- | --- |
| Sequential numbering with no gaps: a number is taken only when a sale completes | Added | `Cleo.bir.issue` |
| Training mode: TRAINING RECEIPT under its own series, never counted | Added | Terminal › Settings › Training mode (manager) |
| Tamper-free clock: sales stop if the device clock is behind the last document | Added | Payment |
| A Z-reading missing from an earlier day is flagged | Added | PIN screen banner |
| A terminal can't be unregistered before its Z-reading | Added | Settings › About |
| Validation seal on every document | Added (demo hash) | Printed in each footer |
| Job-order deposits get a payment receipt; table bill-outs print a bill, not an invoice | Added | PR and BL series |

## Backend work

These are marked `BACKEND:` in `bir.js`, `terminal.js` and `backoffice.js`:

- **Fiscal memory on the device.** Keep numbering on the terminal, so it works offline. Store it in non-volatile, tamper-evident storage, such as an encrypted database on the Android tablet, instead of `localStorage`.
- **The journal on the server.**
  - Upload each journal entry with its sale.
  - Store it append-only: no update or delete.
  - Keep it for at least five years.
  - Build the readings, sales books and backend reports from it.
- **Validation seal.** Replace the demo FNV hash with an HMAC the server can verify. Reject any upload whose seal or series doesn't follow on from the last one.
- **Time.** Compare the device clock with server time on every sync, and log differences in the activity log.
- **Terminal records.** Store each terminal's MIN, serial number, PTU number and PTU date as issued by the BIR (`terminals` collection).
- **Sales data transmission ("push").** The outbox already uploads sales when the terminal is back online. Readings and journal entries should travel the same way.
- **Electronic invoicing.** Taxpayers in the first phase must report invoices to the BIR's Electronic Invoicing System by 31 December 2026 ([Grant Thornton](https://www.grantthornton.com.ph/technical-alerts/tax-alert/2026/bir-issues-guidelines-on-electronic-invoicing-retains-31-dec-2026-deadline/)). The journal already holds every invoice field; transmission is a server job for clients who fall under it.

## Before launch: Aeso and each client

- [ ] **Aeso:** apply for accreditation of Cleo POS under RMO 24-2023. Then fill in the accreditation number and dates in `SUPPLIER` (`bir.js`), or serve them from the server.
- [ ] **Aeso:** confirm the supplier details printed on every invoice: name, address and TIN.
- [ ] **Each client:**
  - register each terminal and get its PTU;
  - enter the business TIN, registered name, business style and each branch's address and branch code in Back Office › Settings.

## To confirm with a tax adviser

- **NAAC and MOV VAT treatment.** Cleo charges VAT on what is left after the 20% discount (no exemption), based on RR 13-2020 summaries. Confirm against the regulation.
- **Service charge on SC and PWD sales.** Cleo computes the service charge on the discounted amount.
- **"Sales for the day"** on the Z-reading is the total of invoices issued that day, voided ones included. Voids and returns are then deducted in the breakdown.
- **"Push functionality" and "validation seal"** in RMO 24-2023 are read as the sales upload and a per-document hash code. Confirm the evaluator reads them the same way.
- **eSales.** Confirm the current eSales template and the regulation behind it; the export columns are a best reading.
- **Backend sales summary columns.** They follow published samples; check them against the template the BIR evaluator uses.

## Sources

- [RMO No. 24-2023 digest (BIR)](https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023%20Digest%20FINAL.pdf)
- [RR No. 7-2024 full text](https://www.offshore-management.com.ph/blog/wordpress/wp-content/uploads/2024/05/RR-7-2024_Full.pdf)
- [RMC No. 77-2024 sample invoices (BIR)](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Annex%20A1-B6.pdf)
- [Clarification of RR 7-2024 as amended by RR 11-2024 (Grant Thornton)](https://www.grantthornton.com.ph/insights/articles-and-updates1/tax-notes/clarification-on-the-invoicing-requirements-per-rr-no-7-2024-as-amended-by-rr-no-11-2024/)
- [EOPT invoicing clarified (PwC)](https://www.pwc.com/ph/en/tax/tax-publications/taxwise-or-otherwise/2024/eopt-invoicing-clarified.html)
- [Accreditation transition, RMC 72-2025 (PwC)](https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2025/tax-alert-22.html)
- [RMO 24-2023 accreditation rules (Makati Law Firm)](https://www.makatilawfirm.com/2023/06/26/rmo-no-24-2023-revised-bir-accreditation-rules-for-pos-crm-e-invoicing-and-sales-receipt-systems/)
- [POS audit trail requirements (Respicio)](https://www.respicio.ph/commentaries/audit-trail-requirements-for-pos-accreditation-in-the-philippines)
- [Solo parent benefits under RA 11861 (PwC)](https://www.pwc.com/ph/en/tax/tax-publications/taxwise-or-otherwise/2023/the-perks-of-being-single.html)
- [Electronic invoicing guidelines and the 31 Dec 2026 deadline (Grant Thornton)](https://www.grantthornton.com.ph/technical-alerts/tax-alert/2026/bir-issues-guidelines-on-electronic-invoicing-retains-31-dec-2026-deadline/)

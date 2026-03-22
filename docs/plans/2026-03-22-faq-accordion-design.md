# FAQ Accordion Section — Design Doc

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add a FAQ accordion section to the home page (`home.njk`) just before the footer. Serves both pre-lead visitors (reassurance, pricing) and post-lead visitors (process, next steps).

## Implementation

- **File:** `src/views/partials/public/faq-section.njk` (new partial)
- **Included in:** `home.njk` immediately before `{% include "partials/public/footer.njk" %}`
- **Accordion behaviour:** Vanilla JS inline script — one item open at a time, first item open by default, chevron rotates 180° on open

## Layout

- Background: `#fafaf7`
- Max-width: `max-w-3xl mx-auto`
- Section heading: "Frequently Asked Questions" — centred, `text-2xl font-bold`
- Items separated by `border-b border-gray-200`
- Question row: bold text + right-aligned chevron SVG
- Answer panel: smooth expand/collapse via `max-height` CSS transition
- Chevron rotation: CSS `transition-transform duration-200`

## Questions & Answers

### Pre-lead (top-of-funnel)

1. **How does the $1,499 fixed fee work?**
   You pay a single flat fee of $1,499 + GST ($1,633.91) when your flat is successfully sold. No percentage commission, no upfront costs, no hidden charges. On a $500,000 flat, you save over $8,000 compared to a typical 2% commission.

2. **Do I get a real agent or just AI?**
   Both. Our AI tools handle the time-consuming work — pricing analysis, listing write-ups, and viewing scheduling. But a CEA-registered agent under Huttons Asia Pte Ltd reviews and approves everything before it reaches any buyer. You always have a licensed human in your corner.

3. **When do I actually pay?**
   Only when your flat is sold. There are no upfront fees and no charges if the transaction doesn't complete. You pay on successful completion.

4. **Is my personal data safe?**
   Yes. The platform is built to Singapore PDPA standards. Your data is used only to provide your selling service. We never sell your data, and we only send marketing communications if you explicitly opt in.

5. **How long does the HDB resale process take?**
   Typically 3–6 months from listing to completion, depending on HDB processing times and how quickly a buyer is found. We guide you at every stage and keep you updated throughout.

### Post-lead (process)

6. **What happens after I submit my details?**
   An agent will contact you within 24 hours to discuss your flat and goals. We'll then prepare a free HDB market report and walk you through the next steps.

7. **How is my flat priced?**
   We analyse recent HDB resale transactions in your block, floor range, and town using live HDB data. Your agent reviews the AI-generated pricing analysis and works with you to set a competitive asking price.

8. **Do I need to handle the HDB paperwork myself?**
   No. Your agent handles the HDB resale submission, coordinates with HDB, and manages the transaction paperwork. You'll be kept informed at each milestone via WhatsApp or email.

9. **Can I withdraw at any time?**
   Yes. There's no lock-in period before you sign the Option to Purchase. If your circumstances change, simply let your agent know.

10. **What if my flat doesn't sell?**
    You pay nothing. Our fixed fee is only due on successful completion. There are no charges if the sale does not go through.

## Technical Notes

- All user-facing strings wrapped in `{{ "..." | t }}` filter
- No new dependencies — vanilla JS only
- Partial file pattern matches existing partials (testimonials-section.njk, footer.njk)

# Sellers List Stage Columns Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Listing Stage" and "Transaction" columns to the agent sellers list table.

**Architecture:** `property.status` is already fetched — Column A needs only a template change. Column B requires a nested transactions include in the repository query, a type update, and a new template column.

**Tech Stack:** TypeScript, Prisma, Nunjucks, Express

---

## Chunk 1: Backend — type + repository

### Task 1: Update `SellerListItem` type

**Files:**
- Modify: `src/domains/agent/agent.types.ts`

The `property` object inside `SellerListItem` needs a `transactionStatus` field. `property.status` is already present.

- [ ] **Step 1: Add `transactionStatus` to the type**

In `src/domains/agent/agent.types.ts`, change the `property` block of `SellerListItem` from:

```ts
property: {
  id: string;
  town: string;
  flatType: string;
  askingPrice: number | null;
  status: string;
} | null;
```

to:

```ts
property: {
  id: string;
  town: string;
  flatType: string;
  askingPrice: number | null;
  status: string;
  transactionStatus: string | null;
} | null;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|warning"
```

Expected: TypeScript errors pointing at `agent.repository.ts` because `transactionStatus` is not yet mapped there. That is expected at this point — proceed to Task 2.

---

### Task 2: Update `getSellerList` repository function

**Files:**
- Modify: `src/domains/agent/agent.repository.ts`

Add a nested `transactions` include to the properties query, then map `transactionStatus` in the return.

- [ ] **Step 1: Add `transactions` include inside the `properties` include**

In `src/domains/agent/agent.repository.ts`, find the `properties` include block (around line 193) and extend it:

```ts
include: {
  properties: {
    take: 1,
    select: {
      id: true,
      town: true,
      flatType: true,
      askingPrice: true,
      status: true,
      transactions: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      },
    },
  },
},
```

- [ ] **Step 2: Map `transactionStatus` in the return**

Find the `sellers.map` block (around line 213) and extend the `property` mapping:

```ts
property: s.properties[0]
  ? {
      id: s.properties[0].id,
      town: s.properties[0].town,
      flatType: s.properties[0].flatType,
      askingPrice: s.properties[0].askingPrice ? Number(s.properties[0].askingPrice) : null,
      status: s.properties[0].status,
      transactionStatus: s.properties[0].transactions[0]?.status ?? null,
    }
  : null,
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npm run build 2>&1 | grep -E "error TS"
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="agent"
```

Expected: all agent tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.repository.ts
git commit -m "feat: include transactionStatus in seller list item"
```

---

## Chunk 2: Frontend — template

### Task 3: Add two columns to the sellers list table

**Files:**
- Modify: `src/views/partials/agent/seller-list.njk`

Add `<th>` headers and `<td>` cells for both new columns, using coloured badge spans consistent with the existing Status column pattern.

- [ ] **Step 1: Add the two `<th>` headers**

Find the `<thead>` row (which currently has Name, Status, Property, Asking Price, Source). Add two new headers after "Status":

```html
<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Listing Stage" | t }}</th>
<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Transaction" | t }}</th>
```

Place them between the "Status" `<th>` and the "Property" `<th>`.

- [ ] **Step 2: Add the Listing Stage `<td>` cell**

After the existing Status `<td>` cell, add:

```html
<td class="px-4 py-3 text-sm">
  {% if seller.property %}
    <span class="px-2 py-1 text-xs rounded-full
      {% if seller.property.status == 'draft' %}bg-gray-100 text-gray-800
      {% elif seller.property.status == 'listed' %}bg-blue-100 text-blue-800
      {% elif seller.property.status == 'offer_received' %}bg-amber-100 text-amber-800
      {% elif seller.property.status == 'under_option' %}bg-orange-100 text-orange-800
      {% elif seller.property.status == 'completing' %}bg-purple-100 text-purple-800
      {% elif seller.property.status == 'completed' %}bg-green-100 text-green-800
      {% elif seller.property.status == 'withdrawn' %}bg-red-100 text-red-800
      {% endif %}">{{ seller.property.status | replace("_", " ") | t }}</span>
  {% else %}—{% endif %}
</td>
```

- [ ] **Step 3: Add the Transaction `<td>` cell**

After the Listing Stage `<td>`, add:

```html
<td class="px-4 py-3 text-sm">
  {% if seller.property and seller.property.transactionStatus %}
    <span class="px-2 py-1 text-xs rounded-full
      {% if seller.property.transactionStatus == 'option_issued' %}bg-blue-100 text-blue-800
      {% elif seller.property.transactionStatus == 'option_exercised' %}bg-indigo-100 text-indigo-800
      {% elif seller.property.transactionStatus == 'completing' %}bg-purple-100 text-purple-800
      {% elif seller.property.transactionStatus == 'completed' %}bg-green-100 text-green-800
      {% elif seller.property.transactionStatus == 'fallen_through' %}bg-red-100 text-red-800
      {% endif %}">{{ seller.property.transactionStatus | replace("_", " ") | t }}</span>
  {% else %}—{% endif %}
</td>
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (template changes have no unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/agent/seller-list.njk
git commit -m "feat: add Listing Stage and Transaction columns to sellers list"
```

---

## Verification

1. Start dev server: `npm run dev`
2. Navigate to `/agent/sellers`
3. Confirm table has 7 columns: Name, Status, Listing Stage, Transaction, Property, Asking Price, Source
4. Seller with no property: Listing Stage and Transaction both show `—`
5. Seller with a listed property and no transaction: Listing Stage shows "listed" badge (blue), Transaction shows `—`
6. Seller with an active transaction: Transaction shows the correct status badge

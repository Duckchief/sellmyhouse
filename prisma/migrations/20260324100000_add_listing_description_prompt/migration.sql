INSERT INTO system_settings (id, key, value, description, updated_at, created_at)
VALUES (
  gen_random_uuid(),
  'listing_description_prompt',
  'You are writing a property listing description for a Singapore HDB flat.
Write 2–3 short paragraphs suitable for PropertyGuru, 99.co, and SRX.
Be factual. Do not make claims you cannot verify from the data provided.
Do not mention price. Do not use superlatives like "rare" or "must-see".
Include a standard disclaimer: "Information is provided for reference only."

Property details:
- Flat type: {flatType}
- Town: {town}
- Address: Blk {block} {street}
- Floor area: {floorAreaSqm} sqm
- Storey: {storey}
- Lease commenced: {leaseCommencementDate}',
  'AI prompt template for generating listing descriptions. Available placeholders: {flatType} {town} {block} {street} {floorAreaSqm} {storey} {leaseCommencementDate}',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

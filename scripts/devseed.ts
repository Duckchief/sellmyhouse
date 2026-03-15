/**
 * Development seed script — populates the database with realistic Singapore
 * property CRM data. Safe to run repeatedly (truncates before inserting).
 *
 * Usage: NODE_ENV=development npx tsx scripts/devseed.ts
 */

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

// ── Guard ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'development') {
  console.error(
    `ERROR: devseed must only run in development. Current NODE_ENV="${process.env.NODE_ENV}"`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────

const id = () => createId();

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Realistic Singapore mobile: 8xxx xxxx or 9xxx xxxx */
function sgPhone(): string {
  const prefix = pick(['8', '9']);
  const rest = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return `+65${prefix}${rest}`;
}

function sgNricLast4(): string {
  const digits = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  const letter = pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
  return `${digits.slice(1)}${letter}`;
}

const BCRYPT_HASH =
  '$2b$12$FQmh/5Ji/YtDUhqu/Hatnubtj36PhvXUtSfMEElZrnkt8VaXvI0Rq'; // "password123"

// ── Reference data ───────────────────────────────────────────

const TOWNS = [
  'ANG MO KIO',
  'BEDOK',
  'BISHAN',
  'BUKIT BATOK',
  'BUKIT MERAH',
  'BUKIT PANJANG',
  'CHOA CHU KANG',
  'CLEMENTI',
  'GEYLANG',
  'HOUGANG',
  'JURONG EAST',
  'JURONG WEST',
  'KALLANG/WHAMPOA',
  'MARINE PARADE',
  'PASIR RIS',
  'PUNGGOL',
  'QUEENSTOWN',
  'SENGKANG',
  'SERANGOON',
  'TAMPINES',
  'TOA PAYOH',
  'WOODLANDS',
  'YISHUN',
];

const STREETS: Record<string, string[]> = {
  'ANG MO KIO': ['ANG MO KIO AVE 3', 'ANG MO KIO AVE 10', 'ANG MO KIO ST 21'],
  BEDOK: ['BEDOK NORTH AVE 1', 'BEDOK SOUTH AVE 2', 'BEDOK RESERVOIR RD'],
  BISHAN: ['BISHAN ST 13', 'BISHAN ST 22', 'BISHAN ST 24'],
  'BUKIT BATOK': ['BUKIT BATOK ST 21', 'BUKIT BATOK WEST AVE 6', 'BUKIT BATOK ST 52'],
  'BUKIT MERAH': ['BUKIT MERAH VIEW', 'LENGKOK BAHRU', 'JLN BUKIT MERAH'],
  'BUKIT PANJANG': ['PETIR RD', 'SENJA RD', 'BUKIT PANJANG RING RD'],
  'CHOA CHU KANG': ['CHOA CHU KANG AVE 1', 'CHOA CHU KANG LOOP', 'CHOA CHU KANG ST 62'],
  CLEMENTI: ['CLEMENTI AVE 3', 'CLEMENTI AVE 4', 'WEST COAST DR'],
  GEYLANG: ['GEYLANG EAST AVE 1', 'SIMS DR', 'ALJUNIED CRES'],
  HOUGANG: ['HOUGANG AVE 5', 'HOUGANG ST 51', 'HOUGANG AVE 10'],
  'JURONG EAST': ['JURONG EAST ST 21', 'JURONG EAST AVE 1', 'TOH GUAN RD'],
  'JURONG WEST': ['JURONG WEST ST 42', 'JURONG WEST AVE 1', 'JURONG WEST ST 52'],
  'KALLANG/WHAMPOA': ['BENDEMEER RD', 'BOON KENG RD', 'WHAMPOA DR'],
  'MARINE PARADE': ['MARINE CRES', 'MARINE DR', 'MARINE TERRACE'],
  'PASIR RIS': ['PASIR RIS ST 12', 'PASIR RIS DR 4', 'PASIR RIS ST 71'],
  PUNGGOL: ['PUNGGOL FIELD', 'PUNGGOL DR', 'EDGEDALE PLAINS'],
  QUEENSTOWN: ['STIRLING RD', 'COMMONWEALTH CRES', 'HOLLAND DR'],
  SENGKANG: ['SENGKANG EAST WAY', 'ANCHORVALE DR', 'RIVERVALE DR'],
  SERANGOON: ['SERANGOON AVE 3', 'SERANGOON NORTH AVE 1', 'LOR LEW LIAN'],
  TAMPINES: ['TAMPINES ST 21', 'TAMPINES ST 42', 'TAMPINES AVE 5'],
  'TOA PAYOH': ['TOA PAYOH LOR 1', 'TOA PAYOH LOR 4', 'TOA PAYOH LOR 8'],
  WOODLANDS: ['WOODLANDS ST 31', 'WOODLANDS AVE 1', 'WOODLANDS DR 50'],
  YISHUN: ['YISHUN AVE 11', 'YISHUN RING RD', 'YISHUN ST 72'],
};

const FLAT_TYPES = ['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE'];
const FLAT_MODELS = [
  'Model A',
  'Improved',
  'New Generation',
  'Premium Apartment',
  'DBSS',
  'Simplified',
  'Model A2',
  'Standard',
  'Apartment',
  'Maisonette',
];
const STOREY_RANGES = [
  '01 TO 03',
  '04 TO 06',
  '07 TO 09',
  '10 TO 12',
  '13 TO 15',
  '16 TO 18',
  '19 TO 21',
  '22 TO 24',
  '25 TO 27',
];
const FLOOR_AREAS: Record<string, number[]> = {
  '2 ROOM': [44, 45, 47],
  '3 ROOM': [60, 65, 67, 68, 73],
  '4 ROOM': [90, 92, 93, 95, 98, 100, 104],
  '5 ROOM': [110, 113, 118, 120, 122],
  EXECUTIVE: [130, 141, 146, 150, 160],
};
const PRICE_RANGES: Record<string, [number, number]> = {
  '2 ROOM': [200_000, 380_000],
  '3 ROOM': [280_000, 520_000],
  '4 ROOM': [400_000, 750_000],
  '5 ROOM': [500_000, 900_000],
  EXECUTIVE: [600_000, 1_100_000],
};
const LEAD_SOURCES = ['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'] as const;
const FIRST_NAMES = [
  'Ah Kow',
  'Mei Ling',
  'Raj',
  'Siti',
  'Ahmad',
  'Wei Ming',
  'Priya',
  'Boon Huat',
  'Nurul',
  'Chun Wei',
  'Lakshmi',
  'Zhi Wen',
  'Farah',
  'Jun Jie',
  'Kavitha',
  'Beng Soon',
  'Aisha',
  'Wai Keong',
  'Deepa',
  'Hui Ling',
  'Siew Leng',
  'Arjun',
  'Hanim',
  'Kok Leong',
  'Rani',
];
const LAST_NAMES = [
  'Tan',
  'Lim',
  'Lee',
  'Ng',
  'Wong',
  'Ong',
  'Koh',
  'Chua',
  'Chan',
  'Teo',
  'Kumar',
  'Singh',
  'Nair',
  'Abdullah',
  'Ibrahim',
  'Hassan',
  'Mohamed',
  'Ismail',
  'Ahmad',
  'Rahman',
  'Goh',
  'Ho',
  'Yeo',
  'Foo',
  'Seah',
];
const NATIONALITIES = [
  'Singaporean',
  'Singaporean',
  'Singaporean',
  'Singaporean',
  'Singaporean',
  'PR',
  'PR',
  'Malaysian',
];
const OCCUPATIONS = [
  'Software Engineer',
  'Teacher',
  'Nurse',
  'Sales Manager',
  'Accountant',
  'Civil Servant',
  'Business Owner',
  'Logistics Manager',
  'Administrative Executive',
  'Retail Manager',
  'F&B Manager',
  'Marketing Executive',
  'Project Manager',
  'Hawker Stall Owner',
  'Grab Driver',
];
const VIDEO_CATEGORIES = ['photography', 'forms', 'process', 'financial'] as const;

function randomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function randomEmail(name: string, idx: number): string {
  const slug = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
  return `${slug}${idx}@example.com`;
}

function randomPrice(flatType: string): number {
  const [lo, hi] = PRICE_RANGES[flatType] ?? [400_000, 700_000];
  return Math.round((lo + Math.random() * (hi - lo)) / 1_000) * 1_000;
}

function randomBlock(): string {
  return String(Math.floor(Math.random() * 800) + 100);
}

function randomLease(): number {
  return 1980 + Math.floor(Math.random() * 40); // 1980–2019
}

// ── Truncation ───────────────────────────────────────────────

async function truncateAll(): Promise<void> {
  console.log('Truncating dev-seeded tables...');

  // Delete in FK-safe order (children first)
  await prisma.dataDeletionRequest.deleteMany();
  await prisma.dataCorrectionRequest.deleteMany();
  await prisma.caseFlag.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.testimonial.deleteMany();
  await prisma.commissionInvoice.deleteMany();
  await prisma.otp.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.agentSetting.deleteMany();
  await prisma.weeklyUpdate.deleteMany();
  await prisma.documentChecklist.deleteMany();
  await prisma.financialReport.deleteMany();
  await prisma.marketContent.deleteMany();
  await prisma.videoTutorial.deleteMany();
  await prisma.viewing.deleteMany();
  await prisma.viewingSlot.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.portalListing.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.estateAgencyAgreement.deleteMany();
  await prisma.cddRecord.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.property.deleteMany();
  await prisma.verifiedViewer.deleteMany();
  await prisma.buyer.deleteMany();
  await prisma.seller.deleteMany();
  await prisma.agent.deleteMany();
  // Deliberately NOT truncating: systemSetting, hdbTransaction, hdbDataSync

  console.log('Truncation complete.');
}

// ── Seed functions ───────────────────────────────────────────

async function seed(): Promise<void> {
  await truncateAll();

  // ── 1. Agents ──────────────────────────────────────────────
  console.log('Seeding agents...');
  const adminAgent = await prisma.agent.create({
    data: {
      id: id(),
      name: 'David Tan',
      email: 'david@sellmyhomenow.sg',
      phone: '+6591234567',
      ceaRegNo: 'R061234A',
      passwordHash: BCRYPT_HASH,
      role: 'admin',
      twoFactorEnabled: false,
    },
  });

  const agents = [adminAgent];
  const agentData = [
    { name: 'Sarah Lim', email: 'sarah@sellmyhomenow.sg', phone: '+6592345678', ceaRegNo: 'R072345B' },
    { name: 'Michael Ng', email: 'michael@sellmyhomenow.sg', phone: '+6593456789', ceaRegNo: 'R083456C' },
  ];
  for (const a of agentData) {
    const agent = await prisma.agent.create({
      data: {
        id: id(),
        ...a,
        passwordHash: BCRYPT_HASH,
        role: 'agent',
        twoFactorEnabled: false,
      },
    });
    agents.push(agent);
  }

  // ── 2. Sellers (50 contacts at various stages) ─────────────
  console.log('Seeding sellers...');
  type CreatedSeller = Awaited<ReturnType<typeof prisma.seller.create>>;
  const sellers: CreatedSeller[] = [];

  // Distribution: 15 leads, 10 engaged, 12 active, 8 completed, 5 archived
  const statusDist: Array<{ status: 'lead' | 'engaged' | 'active' | 'completed' | 'archived'; count: number }> = [
    { status: 'lead', count: 15 },
    { status: 'engaged', count: 10 },
    { status: 'active', count: 12 },
    { status: 'completed', count: 8 },
    { status: 'archived', count: 5 },
  ];

  let sellerIdx = 0;
  for (const { status, count } of statusDist) {
    for (let i = 0; i < count; i++) {
      const name = randomName();
      const isLead = status === 'lead';
      const seller = await prisma.seller.create({
        data: {
          id: id(),
          name,
          email: randomEmail(name, sellerIdx),
          phone: sgPhone(),
          passwordHash: isLead ? null : BCRYPT_HASH,
          agentId: isLead && i < 5 ? null : pick(agents).id,
          status,
          consentService: true,
          consentMarketing: Math.random() > 0.6,
          consentTimestamp: daysAgo(Math.floor(Math.random() * 180)),
          leadSource: pick([...LEAD_SOURCES]),
          onboardingStep: isLead ? pick([0, 1, 2]) : 5,
          consultationCompletedAt:
            status !== 'lead' ? daysAgo(Math.floor(Math.random() * 90) + 10) : null,
        },
      });
      sellers.push(seller);
      sellerIdx++;
    }
  }

  // ── 3. Buyers (10 stub records) ────────────────────────────
  console.log('Seeding buyers...');
  type CreatedBuyer = Awaited<ReturnType<typeof prisma.buyer.create>>;
  const buyers: CreatedBuyer[] = [];
  for (let i = 0; i < 10; i++) {
    const name = randomName();
    const buyer = await prisma.buyer.create({
      data: {
        id: id(),
        name,
        email: randomEmail(name, 100 + i),
        phone: sgPhone(),
        agentId: pick(agents).id,
        status: pick(['lead', 'active', 'completed'] as const),
        consentService: true,
        consentMarketing: Math.random() > 0.7,
        consentTimestamp: daysAgo(Math.floor(Math.random() * 60)),
      },
    });
    buyers.push(buyer);
  }

  // ── 4. Consent records (one per seller + per buyer) ────────
  console.log('Seeding consent records...');
  for (const s of sellers) {
    await prisma.consentRecord.create({
      data: {
        id: id(),
        subjectType: 'seller',
        subjectId: s.id,
        sellerId: s.id,
        purposeService: true,
        purposeMarketing: s.consentMarketing,
        consentGivenAt: s.consentTimestamp ?? new Date(),
        ipAddress: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      },
    });
  }
  for (const b of buyers) {
    await prisma.consentRecord.create({
      data: {
        id: id(),
        subjectType: 'buyer',
        subjectId: b.id,
        buyerId: b.id,
        purposeService: true,
        purposeMarketing: b.consentMarketing,
        consentGivenAt: b.consentTimestamp ?? new Date(),
        ipAddress: `10.0.0.${Math.floor(Math.random() * 254) + 1}`,
        userAgent: 'Mozilla/5.0 (Android 14; Mobile)',
      },
    });
  }

  // ── 5. Properties ──────────────────────────────────────────
  console.log('Seeding properties...');
  type CreatedProperty = Awaited<ReturnType<typeof prisma.property.create>>;
  const properties: CreatedProperty[] = [];

  // Only non-lead sellers get properties
  const sellersWithProperties = sellers.filter((s) => s.status !== 'lead');

  for (const s of sellersWithProperties) {
    const town = pick(TOWNS);
    const flatType = pick(FLAT_TYPES);
    const askingPrice = randomPrice(flatType);
    const propertyStatus =
      s.status === 'completed'
        ? 'completed'
        : s.status === 'archived'
          ? 'withdrawn'
          : pick(['draft', 'listed', 'offer_received', 'under_option'] as const);

    const prop = await prisma.property.create({
      data: {
        id: id(),
        sellerId: s.id,
        town,
        street: pick(STREETS[town] ?? [`${town} ST 1`]),
        block: randomBlock(),
        flatType,
        storeyRange: pick(STOREY_RANGES),
        floorAreaSqm: pick(FLOOR_AREAS[flatType] ?? [93]),
        flatModel: pick(FLAT_MODELS),
        leaseCommenceDate: randomLease(),
        askingPrice,
        slug: `${town.toLowerCase().replace(/[^a-z]/g, '-')}-blk-${randomBlock()}-${id().slice(0, 6)}`,
        status: propertyStatus,
      },
    });
    properties.push(prop);
  }

  // ── 6. Estate Agency Agreements ────────────────────────────
  console.log('Seeding EAAs...');
  type CreatedEAA = Awaited<ReturnType<typeof prisma.estateAgencyAgreement.create>>;
  const eaas: CreatedEAA[] = [];
  const sellersActive = sellers.filter(
    (s) => s.status === 'active' || s.status === 'completed',
  );
  for (const s of sellersActive) {
    const eaa = await prisma.estateAgencyAgreement.create({
      data: {
        id: id(),
        sellerId: s.id,
        agentId: s.agentId ?? agents[0].id,
        agreementType: pick(['non_exclusive', 'exclusive'] as const),
        commissionAmount: 1499,
        signedAt: daysAgo(Math.floor(Math.random() * 60) + 5),
        videoCallConfirmedAt: daysAgo(Math.floor(Math.random() * 60) + 6),
        expiryDate: daysFromNow(Math.floor(Math.random() * 180) + 30),
        status: s.status === 'completed' ? 'expired' : 'active',
      },
    });
    eaas.push(eaa);
  }

  // ── 7. Listings ────────────────────────────────────────────
  console.log('Seeding listings...');
  type CreatedListing = Awaited<ReturnType<typeof prisma.listing.create>>;
  const listings: CreatedListing[] = [];
  const listedProps = properties.filter(
    (p) => p.status === 'listed' || p.status === 'offer_received' || p.status === 'completed',
  );
  for (const p of listedProps) {
    const listing = await prisma.listing.create({
      data: {
        id: id(),
        propertyId: p.id,
        title: `Beautiful ${p.flatType} in ${p.town}`,
        description: `Well-maintained ${p.flatType} flat at Blk ${p.block} ${p.street}. ${p.storeyRange} storey, ${p.floorAreaSqm} sqm. Lease from ${p.leaseCommenceDate}. Near MRT and amenities.`,
        aiDescription: `This charming ${p.flatType} unit offers a well-designed layout with ${p.floorAreaSqm} sqm of living space.`,
        aiDescriptionProvider: 'anthropic',
        aiDescriptionModel: 'claude-sonnet-4-20250514',
        aiDescriptionStatus: 'approved',
        aiDescriptionGeneratedAt: daysAgo(5),
        descriptionApprovedByAgentId: pick(agents).id,
        descriptionApprovedAt: daysAgo(4),
        photos: JSON.stringify([]),
        status: p.status === 'completed' ? 'closed' : 'live',
      },
    });
    listings.push(listing);
  }

  // ── 8. Portal listings ─────────────────────────────────────
  console.log('Seeding portal listings...');
  for (const l of listings.filter((l) => l.status === 'live')) {
    const portals = pickN(
      ['propertyguru', 'ninety_nine_co', 'srx'] as const,
      pick([1, 2, 3]),
    );
    for (const portal of portals) {
      await prisma.portalListing.create({
        data: {
          id: id(),
          listingId: l.id,
          portalName: portal,
          portalReadyContent: { title: 'Portal-ready content' },
          status: pick(['ready', 'posted'] as const),
          postedManuallyAt: Math.random() > 0.5 ? daysAgo(3) : null,
        },
      });
    }
  }

  // ── 9. Verified viewers & viewing slots & viewings ─────────
  console.log('Seeding viewers and viewings...');
  type CreatedViewer = Awaited<ReturnType<typeof prisma.verifiedViewer.create>>;
  const viewers: CreatedViewer[] = [];
  for (let i = 0; i < 20; i++) {
    const vType = pick(['buyer', 'agent'] as const);
    const viewer = await prisma.verifiedViewer.create({
      data: {
        id: id(),
        name: randomName(),
        phone: sgPhone(),
        phoneVerifiedAt: daysAgo(Math.floor(Math.random() * 30)),
        viewerType: vType,
        agentName: vType === 'agent' ? randomName() : null,
        agentCeaReg: vType === 'agent' ? `R${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}Z` : null,
        agentAgencyName: vType === 'agent' ? 'PropNex Realty Pte Ltd' : null,
        consentService: true,
        consentTimestamp: daysAgo(Math.floor(Math.random() * 30)),
        totalBookings: Math.floor(Math.random() * 5),
        retentionExpiresAt: daysFromNow(365),
      },
    });
    viewers.push(viewer);

    // Consent record for viewer
    await prisma.consentRecord.create({
      data: {
        id: id(),
        subjectType: 'viewer',
        subjectId: viewer.id,
        viewerId: viewer.id,
        purposeService: true,
        purposeMarketing: false,
        consentGivenAt: viewer.consentTimestamp ?? new Date(),
        ipAddress: `172.16.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    });
  }

  // Create viewing slots + viewings for listed properties
  const viewableProps = properties.filter((p) => p.status === 'listed' || p.status === 'offer_received');
  for (const p of viewableProps.slice(0, 10)) {
    for (let d = 0; d < 3; d++) {
      const slotDate = daysFromNow(d + 1);
      const slot = await prisma.viewingSlot.create({
        data: {
          id: id(),
          propertyId: p.id,
          date: slotDate,
          startTime: pick(['10:00', '14:00', '16:00']),
          endTime: pick(['10:30', '14:30', '16:30']),
          durationMinutes: 30,
          slotType: 'single',
          maxViewers: 1,
          currentBookings: d === 0 ? 1 : 0,
          status: d === 0 ? 'booked' : 'available',
        },
      });

      if (d === 0) {
        const viewer = pick(viewers);
        await prisma.viewing.create({
          data: {
            id: id(),
            propertyId: p.id,
            viewingSlotId: slot.id,
            verifiedViewerId: viewer.id,
            cancelToken: id(),
            status: 'scheduled',
            scheduledAt: slotDate,
          },
        });
      }
    }
  }

  // Some completed viewings
  for (const p of viewableProps.slice(0, 5)) {
    const pastSlot = await prisma.viewingSlot.create({
      data: {
        id: id(),
        propertyId: p.id,
        date: daysAgo(7),
        startTime: '14:00',
        endTime: '14:30',
        durationMinutes: 30,
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 1,
        status: 'booked',
      },
    });
    await prisma.viewing.create({
      data: {
        id: id(),
        propertyId: p.id,
        viewingSlotId: pastSlot.id,
        verifiedViewerId: pick(viewers).id,
        cancelToken: id(),
        status: 'completed',
        scheduledAt: daysAgo(7),
        completedAt: daysAgo(7),
        feedback: pick([
          'Nice and bright unit, well ventilated',
          'Good condition, reasonable price',
          'Layout a bit small for our needs',
          'Very clean, owners clearly took good care',
          null,
        ]),
        interestRating: pick([3, 4, 5, null]),
      },
    });
  }

  // ── 10. Offers ─────────────────────────────────────────────
  console.log('Seeding offers...');
  type CreatedOffer = Awaited<ReturnType<typeof prisma.offer.create>>;
  const acceptedOffers: CreatedOffer[] = [];

  const offerProps = properties.filter(
    (p) => p.status === 'offer_received' || p.status === 'under_option' || p.status === 'completed',
  );
  for (const p of offerProps) {
    const askNum = Number(p.askingPrice ?? 500_000);
    // 1-3 offers per property
    const numOffers = pick([1, 2, 3]);
    for (let i = 0; i < numOffers; i++) {
      const offerAmt = Math.round(askNum * (0.92 + Math.random() * 0.1) / 1_000) * 1_000;
      const isAccepted = i === 0 && (p.status === 'under_option' || p.status === 'completed');
      const offer = await prisma.offer.create({
        data: {
          id: id(),
          propertyId: p.id,
          buyerName: randomName(),
          buyerPhone: sgPhone(),
          buyerAgentName: Math.random() > 0.5 ? randomName() : null,
          buyerAgentCeaReg: Math.random() > 0.5 ? `R${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}X` : null,
          isCoBroke: Math.random() > 0.6,
          offerAmount: offerAmt,
          status: isAccepted ? 'accepted' : pick(['pending', 'rejected', 'expired'] as const),
          notes: pick([
            'Cash buyer, can complete quickly',
            'First-time buyer, bank loan approved',
            'Downgrader, very motivated',
            null,
          ]),
          retentionExpiresAt: daysFromNow(365 * 5),
        },
      });
      if (isAccepted) acceptedOffers.push(offer);
    }
  }

  // ── 11. CDD Records ───────────────────────────────────────
  console.log('Seeding CDD records...');
  type CreatedCdd = Awaited<ReturnType<typeof prisma.cddRecord.create>>;
  const sellerCddMap = new Map<string, CreatedCdd>();

  const transactableSellers = sellers.filter(
    (s) => s.status === 'active' || s.status === 'completed',
  );
  for (const s of transactableSellers) {
    const cdd = await prisma.cddRecord.create({
      data: {
        id: id(),
        subjectType: 'seller',
        subjectId: s.id,
        fullName: s.name,
        nricLast4: sgNricLast4(),
        dateOfBirth: new Date(1960 + Math.floor(Math.random() * 40), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        nationality: pick([...NATIONALITIES]),
        occupation: pick(OCCUPATIONS),
        riskLevel: Math.random() > 0.9 ? 'enhanced' : 'standard',
        identityVerified: true,
        verifiedByAgentId: s.agentId ?? agents[0].id,
        verifiedAt: daysAgo(Math.floor(Math.random() * 30) + 1),
        documents: JSON.stringify([{ type: 'NRIC', encrypted: true }]),
        retentionExpiresAt: daysFromNow(365 * 5),
      },
    });
    sellerCddMap.set(s.id, cdd);
  }

  // Counterparty CDD for completed
  const counterpartyCddMap = new Map<string, CreatedCdd>();
  const completedSellers = sellers.filter((s) => s.status === 'completed');
  for (const s of completedSellers) {
    const cdd = await prisma.cddRecord.create({
      data: {
        id: id(),
        subjectType: 'counterparty',
        subjectId: s.id,
        fullName: randomName(),
        nricLast4: sgNricLast4(),
        dateOfBirth: new Date(1965 + Math.floor(Math.random() * 35), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        nationality: pick([...NATIONALITIES]),
        occupation: pick(OCCUPATIONS),
        riskLevel: 'standard',
        identityVerified: true,
        verifiedByAgentId: s.agentId ?? agents[0].id,
        verifiedAt: daysAgo(Math.floor(Math.random() * 20) + 1),
        retentionExpiresAt: daysFromNow(365 * 5),
      },
    });
    counterpartyCddMap.set(s.id, cdd);
  }

  // ── 12. Transactions ───────────────────────────────────────
  console.log('Seeding transactions...');
  type CreatedTxn = Awaited<ReturnType<typeof prisma.transaction.create>>;
  const transactions: CreatedTxn[] = [];

  const txnProps = properties.filter(
    (p) => p.status === 'under_option' || p.status === 'completing' || p.status === 'completed',
  );
  let offerIdx = 0;
  for (const p of txnProps) {
    const seller = sellers.find((s) => s.id === p.sellerId)!;
    const eaa = eaas.find((e) => e.sellerId === seller.id);
    const offer = acceptedOffers[offerIdx] ?? null;
    offerIdx++;

    const isCompleted = p.status === 'completed';
    const agreedPrice = offer ? Number(offer.offerAmount) : Number(p.askingPrice ?? 500_000);
    const txnStatus = isCompleted
      ? 'completed'
      : pick(['option_issued', 'option_exercised', 'completing'] as const);
    const hdbStatus = isCompleted
      ? 'completed'
      : pick([
          'not_started',
          'application_submitted',
          'approval_in_principle',
          'approval_granted',
        ] as const);

    const txn = await prisma.transaction.create({
      data: {
        id: id(),
        propertyId: p.id,
        sellerId: seller.id,
        buyerId: buyers.length > 0 ? pick(buyers).id : null,
        estateAgencyAgreementId: eaa?.id ?? null,
        offerId: offer?.id ?? null,
        sellerCddRecordId: sellerCddMap.get(seller.id)?.id ?? null,
        counterpartyCddRecordId: counterpartyCddMap.get(seller.id)?.id ?? null,
        agreedPrice,
        optionFee: Math.round(agreedPrice * 0.01),
        optionDate: daysAgo(Math.floor(Math.random() * 30) + 10),
        exerciseDeadline: daysFromNow(21),
        exerciseDate: txnStatus !== 'option_issued' ? daysAgo(5) : null,
        completionDate: isCompleted ? daysAgo(Math.floor(Math.random() * 30)) : null,
        status: txnStatus,
        hdbApplicationStatus: hdbStatus,
        hdbAppSubmittedAt: hdbStatus !== 'not_started' ? daysAgo(15) : null,
        hdbAppSubmittedByAgentId: hdbStatus !== 'not_started' ? (seller.agentId ?? agents[0].id) : null,
        hdbAppApprovedAt: hdbStatus === 'approval_granted' || hdbStatus === 'completed' ? daysAgo(5) : null,
      },
    });
    transactions.push(txn);
  }

  // ── 13. OTPs ───────────────────────────────────────────────
  console.log('Seeding OTPs...');
  for (const txn of transactions) {
    const otpStatus =
      txn.status === 'completed'
        ? 'exercised'
        : txn.status === 'option_exercised'
          ? 'exercised'
          : pick(['prepared', 'sent_to_seller', 'issued_to_buyer'] as const);
    await prisma.otp.create({
      data: {
        id: id(),
        transactionId: txn.id,
        hdbSerialNumber: `OTP-${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}`,
        status: otpStatus,
        issuedAt: otpStatus !== 'prepared' ? daysAgo(20) : null,
        exercisedAt: otpStatus === 'exercised' ? daysAgo(5) : null,
        agentReviewedAt: otpStatus !== 'prepared' ? daysAgo(19) : null,
        agentReviewedByAgentId: pick(agents).id,
        agentReviewNotes: 'Verified OTP details match.',
      },
    });
  }

  // ── 14. Commission invoices ────────────────────────────────
  console.log('Seeding commission invoices...');
  const completedTxns = transactions.filter((t) => t.status === 'completed');
  for (const txn of completedTxns) {
    await prisma.commissionInvoice.create({
      data: {
        id: id(),
        transactionId: txn.id,
        invoiceNumber: `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        amount: 1499,
        gstAmount: 134.91,
        totalAmount: 1633.91,
        status: pick(['uploaded', 'sent_to_client', 'paid'] as const),
        uploadedAt: daysAgo(10),
        sentAt: daysAgo(8),
        paidAt: Math.random() > 0.3 ? daysAgo(2) : null,
      },
    });
  }

  // ── 15. Financial reports ──────────────────────────────────
  console.log('Seeding financial reports...');
  const activeSellers = sellers.filter((s) => s.status === 'active' || s.status === 'completed');
  for (const s of activeSellers) {
    const prop = properties.find((p) => p.sellerId === s.id);
    if (!prop) continue;

    const salePrice = Number(prop.askingPrice ?? 500_000);
    await prisma.financialReport.create({
      data: {
        id: id(),
        sellerId: s.id,
        propertyId: prop.id,
        reportData: {
          inputs: { salePrice, outstandingLoan: Math.round(salePrice * 0.4), cpfUsed: Math.round(salePrice * 0.15) },
          outputs: { netCashProceeds: Math.round(salePrice * 0.35), estimatedCpfRefund: Math.round(salePrice * 0.15) },
          metadata: { flatType: prop.flatType, town: prop.town, calculatedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue,
        aiNarrative: `Based on the estimated sale price of $${salePrice.toLocaleString()}, after deducting your outstanding HDB loan and CPF refund, your estimated net cash proceeds would be approximately $${Math.round(salePrice * 0.35).toLocaleString()}. This is an indicative estimate only and should not be taken as financial advice.`,
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-20250514',
        status: pick(['approved', 'sent', 'pending_review'] as const),
        reviewedByAgentId: pick(agents).id,
        reviewedAt: daysAgo(3),
        approvedAt: daysAgo(2),
        sentToSellerAt: Math.random() > 0.3 ? daysAgo(1) : null,
        sentVia: 'whatsapp',
        version: 1,
      },
    });
  }

  // ── 16. Weekly updates ─────────────────────────────────────
  console.log('Seeding weekly updates...');
  for (const s of activeSellers.slice(0, 10)) {
    const prop = properties.find((p) => p.sellerId === s.id);
    if (!prop) continue;

    for (let w = 0; w < 3; w++) {
      await prisma.weeklyUpdate.create({
        data: {
          id: id(),
          sellerId: s.id,
          propertyId: prop.id,
          weekOf: daysAgo(w * 7),
          content: `Week ${w + 1} update: ${pick([
            'Received 3 enquiries this week.',
            '2 viewings completed, positive feedback.',
            'Market remains strong in your area.',
            'New comparable sale at $XX,XXX in your block.',
          ])}`,
          aiNarrative: 'AI-generated summary of weekly activity.',
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-20250514',
          status: w === 0 ? 'draft' : 'sent',
          reviewedByAgentId: w > 0 ? pick(agents).id : null,
          reviewedAt: w > 0 ? daysAgo(w * 7 - 1) : null,
          approvedAt: w > 0 ? daysAgo(w * 7 - 1) : null,
          sentToSellerAt: w > 0 ? daysAgo(w * 7) : null,
        },
      });
    }
  }

  // ── 17. Document checklists ────────────────────────────────
  console.log('Seeding document checklists...');
  for (const s of activeSellers.slice(0, 8)) {
    const prop = properties.find((p) => p.sellerId === s.id);
    if (!prop) continue;

    await prisma.documentChecklist.create({
      data: {
        id: id(),
        sellerId: s.id,
        propertyId: prop.id,
        items: [
          { name: 'NRIC / Passport', status: 'provided', required: true },
          { name: 'Title Deed', status: pick(['provided', 'pending']), required: true },
          { name: 'HDB Loan Statement', status: pick(['provided', 'pending', 'not_applicable']), required: false },
          { name: 'CPF Statement', status: pick(['provided', 'pending']), required: true },
          { name: 'Marriage Certificate', status: pick(['provided', 'not_applicable']), required: false },
        ] as Prisma.InputJsonValue,
        status: pick(['draft', 'approved'] as const),
        reviewedByAgentId: pick(agents).id,
        reviewedAt: daysAgo(5),
        approvedAt: daysAgo(4),
      },
    });
  }

  // ── 18. Testimonials ───────────────────────────────────────
  console.log('Seeding testimonials...');
  for (const txn of completedTxns) {
    const seller = sellers.find((s) => s.id === txn.sellerId)!;
    const prop = properties.find((p) => p.id === txn.propertyId);
    const hasContent = Math.random() > 0.3;
    await prisma.testimonial.create({
      data: {
        id: id(),
        sellerId: seller.id,
        transactionId: txn.id,
        content: hasContent
          ? pick([
              'David was very professional and guided us through the entire process. Highly recommend!',
              'Great service, very responsive on WhatsApp. Sold our flat within 2 weeks!',
              'Thank you for the smooth transaction. The financial report was very helpful.',
              'Very transparent process with regular updates. Will refer friends!',
              'Excellent service from start to finish. The platform made everything easy to track.',
            ])
          : null,
        rating: hasContent ? pick([4, 5, 5, 5]) : null,
        sellerName: `${seller.name.split(' ')[0]} ${seller.name.split(' ').pop()?.charAt(0)}.`,
        sellerTown: prop?.town ?? 'TAMPINES',
        status: hasContent ? pick(['approved', 'pending_review'] as const) : 'pending_submission',
        submissionToken: id(),
        tokenExpiresAt: daysFromNow(30),
        displayOnWebsite: hasContent && Math.random() > 0.5,
        approvedByAgentId: hasContent ? pick(agents).id : null,
        approvedAt: hasContent ? daysAgo(2) : null,
      },
    });
  }

  // ── 19. Referrals ──────────────────────────────────────────
  console.log('Seeding referrals...');
  const completedSellersArr = sellers.filter((s) => s.status === 'completed');
  for (const s of completedSellersArr) {
    const hasReferred = Math.random() > 0.5;
    await prisma.referral.create({
      data: {
        id: id(),
        referrerSellerId: s.id,
        referralCode: `REF-${s.name.split(' ')[0].toUpperCase().slice(0, 4)}-${id().slice(0, 6)}`,
        status: hasReferred ? 'lead_created' : 'link_generated',
        clickCount: Math.floor(Math.random() * 10),
        referredSellerId: hasReferred ? pick(sellers.filter((x) => x.id !== s.id)).id : null,
      },
    });
  }

  // ── 20. Case flags ─────────────────────────────────────────
  console.log('Seeding case flags...');
  const flaggedSellers = pickN(activeSellers, 4);
  const flagTypes = ['deceased_estate', 'divorce', 'mop_not_met', 'bank_loan'] as const;
  for (let i = 0; i < flaggedSellers.length; i++) {
    await prisma.caseFlag.create({
      data: {
        id: id(),
        sellerId: flaggedSellers[i].id,
        flagType: flagTypes[i],
        description: {
          deceased_estate: 'Seller is executor of deceased estate. Grant of Probate obtained.',
          divorce: 'Court-ordered sale. Both parties consent.',
          mop_not_met: 'MOP not yet met. Expected to meet MOP in 6 months.',
          bank_loan: 'Outstanding bank loan to be discharged at completion.',
        }[flagTypes[i]],
        status: pick(['identified', 'in_progress', 'resolved'] as const),
        guidanceProvided: 'Agent has briefed seller on additional requirements.',
        resolvedAt: Math.random() > 0.5 ? daysAgo(5) : null,
      },
    });
  }

  // ── 21. Notifications ──────────────────────────────────────
  console.log('Seeding notifications...');
  for (const s of sellers.slice(0, 20)) {
    const templates = ['welcome', 'weekly_update', 'viewing_booked', 'offer_received', 'transaction_update'];
    for (const tmpl of pickN(templates, pick([1, 2, 3]))) {
      await prisma.notification.create({
        data: {
          id: id(),
          recipientType: 'seller',
          recipientId: s.id,
          channel: pick(['whatsapp', 'email', 'in_app'] as const),
          templateName: tmpl,
          content: `Notification: ${tmpl.replace(/_/g, ' ')} for ${s.name}`,
          status: pick(['sent', 'delivered', 'read'] as const),
          sentAt: daysAgo(Math.floor(Math.random() * 14)),
          deliveredAt: daysAgo(Math.floor(Math.random() * 14)),
          readAt: Math.random() > 0.4 ? daysAgo(Math.floor(Math.random() * 7)) : null,
        },
      });
    }
  }

  // Agent notifications
  for (const a of agents) {
    for (let i = 0; i < 5; i++) {
      await prisma.notification.create({
        data: {
          id: id(),
          recipientType: 'agent',
          recipientId: a.id,
          channel: 'in_app',
          templateName: pick(['new_lead', 'offer_received', 'viewing_completed', 'document_uploaded', 'seller_inactive']),
          content: `Agent alert: ${pick(['New lead assigned', 'Offer received on listing', 'Viewing feedback submitted', 'Document uploaded by seller', 'Seller inactive for 14 days'])}`,
          status: pick(['sent', 'delivered', 'read'] as const),
          sentAt: daysAgo(Math.floor(Math.random() * 7)),
        },
      });
    }
  }

  // ── 22. Video tutorials ────────────────────────────────────
  console.log('Seeding video tutorials...');
  const tutorials = [
    { title: 'How to Photograph Your HDB Flat', slug: 'photo-hdb-flat', category: 'photography' as const, desc: 'Tips for taking great photos of your HDB flat using your smartphone.' },
    { title: 'Understanding the OTP Process', slug: 'otp-process', category: 'process' as const, desc: 'Step-by-step guide to the Option to Purchase process for HDB resale.' },
    { title: 'Reading Your Financial Report', slug: 'financial-report-guide', category: 'financial' as const, desc: 'How to interpret your net proceeds estimate and what each line item means.' },
    { title: 'Filling the Resale Application Form', slug: 'resale-form', category: 'forms' as const, desc: 'Walk-through of the HDB resale application form.' },
    { title: 'Preparing for HDB Appointment', slug: 'hdb-appointment-prep', category: 'process' as const, desc: 'What to bring and expect at your HDB appointment.' },
    { title: 'Staging Your Flat for Viewings', slug: 'staging-tips', category: 'photography' as const, desc: 'Simple staging tips to make your flat look its best for viewings.' },
  ];
  for (let i = 0; i < tutorials.length; i++) {
    await prisma.videoTutorial.create({
      data: {
        id: id(),
        title: tutorials[i].title,
        slug: tutorials[i].slug,
        description: tutorials[i].desc,
        youtubeUrl: `https://www.youtube.com/watch?v=example${i + 1}`,
        category: tutorials[i].category,
        orderIndex: i,
      },
    });
  }

  // ── 23. Market content ─────────────────────────────────────
  console.log('Seeding market content...');
  for (let w = 1; w <= 4; w++) {
    const town = pick(TOWNS);
    await prisma.marketContent.create({
      data: {
        id: id(),
        town,
        flatType: pick(FLAT_TYPES),
        period: `2026-W${w + 8}`,
        rawData: {
          topTowns: [{ town, medianPrice: 550_000, volume: 42 }],
          millionDollar: { count: w },
          trends: { yoyChange: 3.2, qoqChange: 0.8 },
        } as Prisma.InputJsonValue,
        aiNarrative: `The HDB resale market in ${town} saw healthy activity this week with median prices holding steady.`,
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-20250514',
        status: w <= 2 ? 'published' : 'pending_review',
        tiktokFormat: `HDB prices in ${town} 📊 Still going up! Check the latest data.`,
        instagramFormat: `Weekly Market Update: ${town} HDB resale prices remain strong with ${pick([3, 5, 8])} transactions this week.`,
        approvedByAgentId: w <= 2 ? pick(agents).id : null,
        approvedAt: w <= 2 ? daysAgo(w * 7) : null,
        publishedAt: w <= 2 ? daysAgo(w * 7) : null,
      },
    });
  }

  // ── 24. Audit logs (sample) ────────────────────────────────
  console.log('Seeding audit logs...');
  const auditActions = [
    { action: 'seller.create', entityType: 'seller' },
    { action: 'property.create', entityType: 'property' },
    { action: 'listing.approve', entityType: 'listing' },
    { action: 'offer.accept', entityType: 'offer' },
    { action: 'transaction.create', entityType: 'transaction' },
    { action: 'cdd.verify', entityType: 'cdd_record' },
    { action: 'eaa.sign', entityType: 'eaa' },
    { action: 'consent.record', entityType: 'consent' },
    { action: 'financial_report.approve', entityType: 'financial_report' },
    { action: 'agent.login', entityType: 'agent' },
  ];
  for (let i = 0; i < 30; i++) {
    const aa = pick(auditActions);
    await prisma.auditLog.create({
      data: {
        id: id(),
        agentId: pick(agents).id,
        action: aa.action,
        entityType: aa.entityType,
        entityId: id(),
        details: { source: 'devseed', index: i } as Prisma.InputJsonValue,
        ipAddress: '127.0.0.1',
        createdAt: daysAgo(Math.floor(Math.random() * 30)),
      },
    });
  }

  // ── Summary ────────────────────────────────────────────────
  console.log('\n--- Dev Seed Summary ---');
  console.log(`Agents:             ${agents.length}`);
  console.log(`Sellers:            ${sellers.length}`);
  console.log(`Buyers:             ${buyers.length}`);
  console.log(`Properties:         ${properties.length}`);
  console.log(`EAAs:               ${eaas.length}`);
  console.log(`Listings:           ${listings.length}`);
  console.log(`Viewers:            ${viewers.length}`);
  console.log(`Offers:             ${acceptedOffers.length} accepted / ${offerProps.length * 2}+ total`);
  console.log(`Transactions:       ${transactions.length}`);
  console.log(`Completed txns:     ${completedTxns.length}`);
  console.log('Done!\n');
}

// ── Run ──────────────────────────────────────────────────────

seed()
  .catch((e) => {
    console.error('Dev seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

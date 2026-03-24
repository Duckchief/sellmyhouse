import { saveSaleProceeds } from '../seller.service';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    saleProceeds: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock('../../shared/settings.service');

const { prisma } = jest.requireMock('@/infra/database/prisma');

describe('saveSaleProceeds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.saleProceeds.upsert.mockResolvedValue({ id: 'sp1' });
  });

  it('calculates net proceeds correctly with all CPF contributors', async () => {
    await saveSaleProceeds({
      sellerId: 'seller1',
      sellingPrice: 600000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: 30000,
      cpfSeller3: 10000,
      cpfSeller4: 5000,
      resaleLevy: 40000,
      otherDeductions: 5000,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 258366.09,
        }),
      }),
    );
  });

  it('calculates net proceeds with only one CPF contributor', async () => {
    await saveSaleProceeds({
      sellerId: 'seller2',
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 248366.09,
        }),
      }),
    );
  });

  it('handles negative proceeds', async () => {
    await saveSaleProceeds({
      sellerId: 'seller3',
      sellingPrice: 300000,
      outstandingLoan: 250000,
      cpfSeller1: 100000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: -51633.91,
        }),
      }),
    );
  });

  it('rounds net proceeds to 2 decimal places', async () => {
    await saveSaleProceeds({
      sellerId: 'seller4',
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 33333.33,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    const call = prisma.saleProceeds.upsert.mock.calls[0][0];
    const netProceeds = call.create.netProceeds;
    const decimalPart = netProceeds.toString().split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(2);
  });

  it('deducts buyer deposit from net proceeds', async () => {
    await saveSaleProceeds({
      sellerId: 'seller5',
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
      buyerDeposit: 3000,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 245366.09,
        }),
      }),
    );
  });

  it('treats omitted buyer deposit as zero', async () => {
    await saveSaleProceeds({
      sellerId: 'seller6',
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 248366.09,
        }),
      }),
    );
  });
});

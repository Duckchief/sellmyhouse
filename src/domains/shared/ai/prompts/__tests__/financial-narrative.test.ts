import { buildFinancialNarrativePrompt } from '../financial-narrative';
import type { FinancialCalculationOutput } from '../../../../property/financial.types';

const sampleOutput: FinancialCalculationOutput = {
  salePrice: 500000,
  outstandingLoan: 200000,
  owner1Cpf: {
    oaUsed: 100000,
    accruedInterest: 28008.45,
    totalRefund: 128008.45,
    isEstimated: false,
  },
  totalCpfRefund: 128008.45,
  resaleLevy: 40000,
  commission: 1633.91,
  legalFees: 2500,
  totalDeductions: 372142.36,
  netCashProceeds: 127857.64,
  warnings: [],
};

describe('buildFinancialNarrativePrompt', () => {
  it('includes Singapore HDB context', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('Singapore');
    expect(prompt).toContain('HDB');
  });

  it('includes the actual financial figures', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('500,000');
    expect(prompt).toContain('127,858'); // toLocaleString rounds 127857.64 → 127,858
  });

  it('includes disclaimer instruction', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('disclaimer');
  });

  it('mentions estimated CPF when applicable', () => {
    const estimatedOutput = {
      ...sampleOutput,
      owner1Cpf: { ...sampleOutput.owner1Cpf, isEstimated: true },
    };
    const prompt = buildFinancialNarrativePrompt(estimatedOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('estimated');
  });

  it('includes negative proceeds warning when applicable', () => {
    const negativeOutput = {
      ...sampleOutput,
      netCashProceeds: -50000,
      warnings: ['Based on the figures provided, the sale proceeds may not cover all deductions.'],
    };
    const prompt = buildFinancialNarrativePrompt(negativeOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('negative');
  });

  it('includes joint owner breakdown when present', () => {
    const jointOutput = {
      ...sampleOutput,
      owner2Cpf: {
        oaUsed: 50000,
        accruedInterest: 14004.22,
        totalRefund: 64004.22,
        isEstimated: false,
      },
      totalCpfRefund: 192012.67,
    };
    const prompt = buildFinancialNarrativePrompt(jointOutput, { town: 'TAMPINES', flatType: '4 ROOM' });
    expect(prompt).toContain('Owner 2');
  });
});

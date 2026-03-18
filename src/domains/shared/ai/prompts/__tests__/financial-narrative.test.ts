import { buildFinancialNarrativePrompt } from '../financial-narrative';
import type { FinancialCalculationOutput } from '../../../../property/financial.types';

const sampleOutput: FinancialCalculationOutput = {
  salePrice: 500000,
  outstandingLoan: 200000,
  ownerCpfRefunds: [128000],
  totalCpfRefund: 128000,
  resaleLevy: 40000,
  commission: 1633.91,
  legalFees: 2500,
  totalDeductions: 372133.91,
  netCashProceeds: 127866.09,
  warnings: [],
};

describe('buildFinancialNarrativePrompt', () => {
  it('includes Singapore HDB context', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('Singapore');
    expect(prompt).toContain('HDB');
  });

  it('includes the actual financial figures', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('500,000');
    expect(prompt).toContain('127,866');
  });

  it('includes disclaimer instruction', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('disclaimer');
  });

  it('notes that CPF figures are seller-provided', () => {
    const prompt = buildFinancialNarrativePrompt(sampleOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('seller');
  });

  it('includes negative proceeds warning when applicable', () => {
    const negativeOutput = {
      ...sampleOutput,
      netCashProceeds: -50000,
      warnings: ['Based on the figures provided, the sale proceeds may not cover all deductions.'],
    };
    const prompt = buildFinancialNarrativePrompt(negativeOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('negative');
  });

  it('includes per-owner CPF rows for multiple owners', () => {
    const jointOutput = {
      ...sampleOutput,
      ownerCpfRefunds: [128000, 64000],
      totalCpfRefund: 192000,
    };
    const prompt = buildFinancialNarrativePrompt(jointOutput, {
      town: 'TAMPINES',
      flatType: '4 ROOM',
    });
    expect(prompt).toContain('Owner 1');
    expect(prompt).toContain('Owner 2');
  });
});

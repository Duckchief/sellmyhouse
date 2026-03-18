/** Flat types for resale levy lookup */
export type FlatType = '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE' | 'MULTI-GENERATION';

export type SubsidyType = 'subsidised' | 'non_subsidised';

/**
 * One combined CPF figure per owner — principal + accrued interest combined.
 * Seller self-reports this from my.cpf.gov.sg → Home Ownership.
 * Mirrors HDB's own sales proceeds calculator approach.
 */
export interface CpfOwnerInput {
  cpfRefund: number; // total CPF monies utilised including accrued interest
}

export interface FinancialCalculationInput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfs: CpfOwnerInput[]; // 1–4 owners, matching HDB's calculator limit
  flatType: FlatType;
  subsidyType: SubsidyType;
  isFirstTimer: boolean;
  legalFeesEstimate?: number; // defaults to 2500 if not provided
}

export interface FinancialCalculationOutput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfRefunds: number[]; // parallel array to ownerCpfs — one entry per owner
  totalCpfRefund: number;
  resaleLevy: number;
  commission: number; // always from SystemSetting ($1,633.91)
  legalFees: number;
  totalDeductions: number;
  netCashProceeds: number;
  warnings: string[];
}

export interface FinancialReportData {
  inputs: FinancialCalculationInput;
  outputs: FinancialCalculationOutput;
  metadata: {
    flatType: string;
    town: string;
    leaseCommenceDate: number;
    calculatedAt: string; // ISO timestamp
    cpfDisclaimerShownAt: string; // ISO timestamp — when seller was shown the disclaimer
  };
}

export interface CreateReportInput {
  sellerId: string;
  propertyId: string;
  calculationInput: FinancialCalculationInput;
  metadata: {
    flatType: string;
    town: string;
    leaseCommenceDate: number;
    cpfDisclaimerShownAt: string; // ISO timestamp from Seller.cpfDisclaimerShownAt
  };
}

export interface ApproveReportInput {
  reportId: string;
  agentId: string;
  reviewNotes?: string;
}

export interface SendReportInput {
  reportId: string;
  agentId: string;
  channel: 'whatsapp' | 'email' | 'in_app';
}

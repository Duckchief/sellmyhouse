/** Flat types for resale levy lookup */
export type FlatType = '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE' | 'MULTI-GENERATION';

export type SubsidyType = 'subsidised' | 'non_subsidised';

export type ReportStatus = 'generated' | 'pending_review' | 'approved' | 'sent';

export interface CpfOwnerInput {
  oaUsed: number | null; // null = unknown
  purchaseYear: number;
}

export interface FinancialCalculationInput {
  salePrice: number;
  outstandingLoan: number;
  owner1Cpf: CpfOwnerInput;
  owner2Cpf?: CpfOwnerInput; // optional joint owner
  flatType: FlatType;
  subsidyType: SubsidyType;
  isFirstTimer: boolean;
  legalFeesEstimate?: number; // defaults to 2500 if not provided
}

export interface CpfBreakdown {
  oaUsed: number;
  accruedInterest: number;
  totalRefund: number;
  isEstimated: boolean; // true if oaUsed was unknown and we estimated
}

export interface FinancialCalculationOutput {
  salePrice: number;
  outstandingLoan: number;
  owner1Cpf: CpfBreakdown;
  owner2Cpf?: CpfBreakdown;
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

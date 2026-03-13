// src/domains/transaction/transaction.types.ts
import type {
  TransactionStatus,
  OtpStatus,
  InvoiceStatus,
  HdbApplicationStatus,
} from '@prisma/client';

export type { TransactionStatus, OtpStatus, InvoiceStatus, HdbApplicationStatus };

// OTP strict sequential transitions — only one valid next state per current state
// null means terminal (no further transitions allowed)
export const OTP_TRANSITIONS: Record<OtpStatus, OtpStatus | null> = {
  prepared: 'sent_to_seller',
  sent_to_seller: 'signed_by_seller',
  signed_by_seller: 'returned',
  returned: 'issued_to_buyer',
  issued_to_buyer: 'exercised',
  exercised: null,
  expired: null,
};

// Transaction status progression
// fallen_through can be reached from any non-terminal status
export const TRANSACTION_STATUS_ORDER: TransactionStatus[] = [
  'option_issued',
  'option_exercised',
  'completing',
  'completed',
];

export interface CreateTransactionInput {
  propertyId: string;
  sellerId: string;
  offerId: string;
  agreedPrice: number;
  optionFee?: number;
  optionDate?: Date;
  agentId: string;
}

export interface CreateOtpInput {
  transactionId: string;
  hdbSerialNumber: string;
  agentId: string;
}

export interface AdvanceOtpInput {
  transactionId: string;
  notes?: string;
  issuedAt?: Date; // optional past date for issued_to_buyer transition; defaults to new Date()
  agentId: string;
}

export interface UploadOtpScanInput {
  transactionId: string;
  scanType: 'seller' | 'returned';
  fileBuffer: Buffer;
  originalFilename: string;
  agentId: string;
}

export interface UploadInvoiceInput {
  transactionId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  invoiceNumber: string;
  agentId: string;
}

import type { FinancialCalculationOutput } from '../../../property/financial.types';

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function buildFinancialNarrativePrompt(
  output: FinancialCalculationOutput,
  context: { town: string; flatType: string },
): string {
  const sections: string[] = [];

  sections.push(
    `You are a helpful assistant for SellMyHomeNow.sg, a Singapore HDB resale transaction platform.`,
  );
  sections.push(
    `Write a clear, friendly, plain-language summary of this seller's estimated financial breakdown for selling their ${context.flatType} flat in ${context.town}.`,
  );
  sections.push('');
  sections.push('## Financial Figures');
  sections.push(`- Sale Price: $${formatCurrency(output.salePrice)}`);
  sections.push(`- Outstanding Loan: $${formatCurrency(output.outstandingLoan)}`);

  // Owner 1 CPF
  sections.push(
    `- Owner 1 CPF Refund: $${formatCurrency(output.owner1Cpf.totalRefund)} (OA used: $${formatCurrency(output.owner1Cpf.oaUsed)}, accrued interest: $${formatCurrency(output.owner1Cpf.accruedInterest)})`,
  );
  if (output.owner1Cpf.isEstimated) {
    sections.push(`  (Note: Owner 1 CPF usage was estimated — actual figures may differ)`);
  }

  // Owner 2 CPF (joint owner)
  if (output.owner2Cpf) {
    sections.push(
      `- Owner 2 CPF Refund: $${formatCurrency(output.owner2Cpf.totalRefund)} (OA used: $${formatCurrency(output.owner2Cpf.oaUsed)}, accrued interest: $${formatCurrency(output.owner2Cpf.accruedInterest)})`,
    );
    if (output.owner2Cpf.isEstimated) {
      sections.push(`  (Note: Owner 2 CPF usage was estimated — actual figures may differ)`);
    }
  }

  sections.push(`- Total CPF Refund: $${formatCurrency(output.totalCpfRefund)}`);
  sections.push(`- Resale Levy: $${formatCurrency(output.resaleLevy)}`);
  sections.push(`- Commission (including GST): $${formatCurrency(output.commission)}`);
  sections.push(`- Estimated Legal Fees: $${formatCurrency(output.legalFees)}`);
  sections.push(`- **Estimated Net Cash Proceeds: $${formatCurrency(output.netCashProceeds)}**`);

  if (output.netCashProceeds < 0) {
    sections.push('');
    sections.push(
      'IMPORTANT: The net proceeds are negative. The seller needs to be informed sensitively that the sale proceeds may not cover all deductions.',
    );
  }

  sections.push('');
  sections.push('## Instructions');
  sections.push('- Write 3-5 short paragraphs in simple English');
  sections.push('- Explain each deduction briefly so the seller understands where the money goes');
  sections.push('- Use a reassuring, professional tone');
  sections.push(
    '- End with a disclaimer: "This is an estimate only and does not constitute financial advice. Please refer to CPF Board (my.cpf.gov.sg) and HDB (hdb.gov.sg) for exact figures."',
  );
  sections.push('- Do NOT provide financial advice or make recommendations');
  sections.push('- Do NOT use technical jargon — explain terms like "accrued interest" simply');

  if (output.owner1Cpf.isEstimated || output.owner2Cpf?.isEstimated) {
    sections.push(
      '- Clearly note which CPF figures are estimated and direct the seller to check my.cpf.gov.sg for actual amounts',
    );
  }

  return sections.join('\n');
}

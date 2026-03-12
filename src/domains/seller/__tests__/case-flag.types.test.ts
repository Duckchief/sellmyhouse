import {
  CASE_FLAG_CHECKLISTS,
  type CreateCaseFlagInput,
  type UpdateCaseFlagInput,
} from '../case-flag.types';

describe('CASE_FLAG_CHECKLISTS', () => {
  it('has an entry for every CaseFlagType', () => {
    const expectedTypes = [
      'deceased_estate',
      'divorce',
      'mop_not_met',
      'eip_restriction',
      'pr_quota',
      'bank_loan',
      'court_order',
      'other',
    ];
    for (const type of expectedTypes) {
      expect(CASE_FLAG_CHECKLISTS[type as keyof typeof CASE_FLAG_CHECKLISTS]).toBeDefined();
      expect(
        CASE_FLAG_CHECKLISTS[type as keyof typeof CASE_FLAG_CHECKLISTS].length,
      ).toBeGreaterThan(0);
    }
  });

  it('mop_not_met checklist mentions MOP date', () => {
    expect(CASE_FLAG_CHECKLISTS.mop_not_met.some((item) => item.includes('MOP'))).toBe(true);
  });
});

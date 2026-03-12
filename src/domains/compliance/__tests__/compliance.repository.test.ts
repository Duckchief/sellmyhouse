// src/domains/compliance/__tests__/compliance.repository.test.ts
import * as complianceRepo from '../compliance.repository';

// This is a light smoke test — full DB tests are in tests/integration/
describe('compliance.repository', () => {
  it('exports expected functions', () => {
    expect(typeof complianceRepo.createConsentRecord).toBe('function');
    expect(typeof complianceRepo.findLatestConsentRecord).toBe('function');
    expect(typeof complianceRepo.createDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findDeletionRequest).toBe('function');
    expect(typeof complianceRepo.updateDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findPendingDeletionRequests).toBe('function');
  });
});

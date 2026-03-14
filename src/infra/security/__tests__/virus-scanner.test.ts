import { scanBuffer } from '../virus-scanner';

// ClamAV is not available in test environment — scanner is disabled by default.
// These tests verify graceful degradation behaviour.

describe('virus-scanner', () => {
  it('returns clean when scanner is disabled (dev/test mode)', async () => {
    const buffer = Buffer.from('test file content');
    const result = await scanBuffer(buffer, 'test.pdf');
    expect(result.isClean).toBe(true);
    expect(result.viruses).toEqual([]);
  });

  it('returns clean for different file types when scanner is disabled', async () => {
    const buffer = Buffer.from('fake image data');
    const result = await scanBuffer(buffer, 'photo.jpg');
    expect(result.isClean).toBe(true);
    expect(result.viruses).toEqual([]);
  });
});

export const generateSecret = jest.fn().mockReturnValue('MOCK_SECRET');
export const generateURI = jest.fn().mockReturnValue('otpauth://totp/mock');
export const generate = jest.fn().mockResolvedValue('123456');
export const generateSync = jest.fn().mockReturnValue('123456');
export const verify = jest.fn().mockResolvedValue({ valid: true, delta: 0 });
export const verifySync = jest.fn().mockReturnValue({ valid: true, delta: 0 });

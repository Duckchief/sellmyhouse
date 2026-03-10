import * as settingsRepo from './settings.repository';
import type { SettingKey } from './settings.types';
import { AppError } from './errors';

export async function get(key: SettingKey | string, defaultValue?: string): Promise<string> {
  const setting = await settingsRepo.findByKey(key);
  if (!setting) {
    if (defaultValue !== undefined) return defaultValue;
    throw new AppError(`Setting not found: ${key}`, 404, 'NOT_FOUND');
  }
  return setting.value;
}

export async function getNumber(key: SettingKey | string, defaultValue?: number): Promise<number> {
  const value = await get(key, defaultValue?.toString());
  return parseFloat(value);
}

export async function getBoolean(key: SettingKey | string, defaultValue?: boolean): Promise<boolean> {
  const value = await get(key, defaultValue?.toString());
  return value === 'true';
}

export async function getCommission(): Promise<{
  amount: number;
  gstRate: number;
  gstAmount: number;
  total: number;
}> {
  const amount = await getNumber('commission_amount');
  const gstRate = await getNumber('gst_rate');
  const gstAmount = Math.round(amount * gstRate * 100) / 100;
  const total = Math.round((amount + gstAmount) * 100) / 100;
  return { amount, gstRate, gstAmount, total };
}

import * as repo from './agent-settings.repository';
import * as auditService from '../shared/audit.service';
import { encrypt, decrypt } from '../shared/encryption';
import type { AgentSettingKey, AgentSettingsView } from './agent-settings.types';
import { WHATSAPP_KEYS, SMTP_KEYS } from './agent-settings.types';
import { logger } from '../../infra/logger';
import nodemailer from 'nodemailer';
import axios from 'axios';

export async function saveSetting(
  agentId: string,
  key: AgentSettingKey,
  value: string,
): Promise<void> {
  const encryptedValue = encrypt(value);
  await repo.upsert(agentId, key, encryptedValue);

  await auditService.log({
    agentId,
    action: 'agent_setting.updated',
    entityType: 'agent_setting',
    entityId: agentId,
    details: { key }, // Never log the value
  });
}

export async function getSetting(agentId: string, key: AgentSettingKey): Promise<string | null> {
  const record = await repo.findByKey(agentId, key);
  if (!record) return null;
  return decrypt(record.encryptedValue);
}

export async function getSettingsView(agentId: string): Promise<AgentSettingsView[]> {
  const allKeys: AgentSettingKey[] = [...WHATSAPP_KEYS, ...SMTP_KEYS];
  const records = await repo.findAllForAgent(agentId);
  const recordMap = new Map(records.map((r) => [r.key, r]));

  return allKeys.map((key) => {
    const record = recordMap.get(key);
    if (!record) {
      return { key, maskedValue: null, updatedAt: null };
    }

    let decrypted: string | null = null;
    try {
      decrypted = decrypt(record.encryptedValue);
    } catch (err) {
      logger.warn({ key: record.key, agentId, err }, 'Failed to decrypt agent setting');
      return { key: record.key as AgentSettingKey, maskedValue: null, updatedAt: record.updatedAt };
    }
    const masked = maskValue(key, decrypted);
    return { key, maskedValue: masked, updatedAt: record.updatedAt };
  });
}

export async function testWhatsAppConnection(
  agentId: string,
): Promise<{ success: boolean; message: string }> {
  const token = await getSetting(agentId, 'whatsapp_api_token');
  const phoneNumberId = await getSetting(agentId, 'whatsapp_phone_number_id');

  if (!token || !phoneNumberId) {
    return { success: false, message: 'WhatsApp credentials not configured' };
  }

  try {
    await axios.get(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    return { success: true, message: 'WhatsApp connection successful' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    await auditService.log({
      action: 'agent_settings.test_failed',
      entityType: 'agent_setting',
      entityId: agentId,
      details: { channel: 'whatsapp', error: message },
    });
    return { success: false, message };
  }
}

export async function testSmtpConnection(
  agentId: string,
): Promise<{ success: boolean; message: string }> {
  const host = await getSetting(agentId, 'smtp_host');
  const port = await getSetting(agentId, 'smtp_port');
  const user = await getSetting(agentId, 'smtp_user');
  const pass = await getSetting(agentId, 'smtp_pass');

  if (!host || !port || !user || !pass) {
    return { success: false, message: 'SMTP credentials not fully configured' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: parseInt(port, 10) === 465,
      auth: { user, pass },
    });

    await transporter.verify();
    return { success: true, message: 'SMTP connection successful' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    await auditService.log({
      action: 'agent_settings.test_failed',
      entityType: 'agent_setting',
      entityId: agentId,
      details: { channel: 'smtp', error: message },
    });
    return { success: false, message };
  }
}

function maskValue(key: AgentSettingKey, value: string): string {
  if (key.includes('token') || key.includes('pass') || key.includes('api')) {
    if (value.length <= 4) return '****';
    return '****' + value.slice(-4);
  }
  return value;
}

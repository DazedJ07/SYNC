/**
 * QR code generation & parsing utilities
 * Extracted from script.js
 */
import { getAppBaseUrl } from './supabase.js';

const SESSION_QR_TTL_MS = 30 * 1000;
const ATT_DYNAMIC_TTL_MS = 45 * 1000;

/** Admin: generate a session QR URL that students scan to trigger check-in */
export function buildAdminSessionPayload() {
  const expMs = Date.now() + SESSION_QR_TTL_MS;
  const token = Math.random().toString(36).substring(2, 10);
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}?action=checkin&token=${token}&expires=${expMs}`;
}

/** Student: rolling attendance QR for admin scanner */
export function buildRollingAttendancePayload(empId) {
  const expMs = Date.now() + ATT_DYNAMIC_TTL_MS;
  return `SYNC_ORG|${empId}|e${expMs.toString(36)}`;
}

/** Parse scanned QR text (admin scanning student code) */
export function parseScannedAttendancePayload(text) {
  const raw = String(text || '').trim();
  const parts = raw.split('|');
  if (parts.length >= 3 && parts[0] === 'SYNC_ORG') {
    const empId = parts[1];
    const token = parts[2];
    let expMs;
    if (/^\d{10,}$/.test(token)) {
      expMs = parseInt(token, 10);
    } else {
      const m = /^e([0-9a-z]+)$/i.exec(token);
      if (!m) return { error: 'bad_format' };
      expMs = parseInt(m[1], 36);
    }
    if (!Number.isFinite(expMs)) return { error: 'bad_format' };
    if (Date.now() > expMs) return { error: 'expired', empId };
    return { empId };
  }
  return { empId: raw };
}

/** Build QR image URL via external API */
export function getQrImageUrl(data, size = 200) {
  const enc = encodeURIComponent(String(data ?? ''));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${enc}`;
}

export { SESSION_QR_TTL_MS, ATT_DYNAMIC_TTL_MS };

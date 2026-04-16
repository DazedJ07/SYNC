/**
 * Supabase client & shared helpers
 * Extracted from script.js to be used across React components
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yhiqtdgoeuctpybvjbrc.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloaXF0ZGdvZXVjdHB5YnZqYnJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjIyOTMsImV4cCI6MjA5MTE5ODI5M30.4hjObsvtcrm5GRZ9MvA31xfgTqwHoalkuWa_5R9itrg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    detectSessionInUrl: true,
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const ORG_SECRET = String(import.meta.env.VITE_ORG_SECRET || '2026').trim();

// ── Date helpers ──────────────────────────────────────────────────────────────
export function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Status derivation ─────────────────────────────────────────────────────────
export function deriveDisplayStatus(emp, now = new Date()) {
  if (emp.status === 'Excused') return 'Excused';
  const today = localDateStr(now);
  let last = null;
  if (emp.last_check_in_at) {
    last = new Date(emp.last_check_in_at);
    if (Number.isNaN(last.getTime())) last = null;
  }
  if (last) {
    const lastDay = localDateStr(last);
    if (lastDay === today) {
      const mins = last.getHours() * 60 + last.getMinutes();
      return mins > 8 * 60 + 30 ? 'Late' : 'Present';
    }
    return 'Absent';
  }
  if (emp.status === 'Absent') return 'Absent';
  if (emp.status === 'Present') return 'Present';
  if (emp.status === 'Late') return 'Late';
  return 'No Record';
}

// ── Daily attendance upsert ───────────────────────────────────────────────────
export async function upsertAttendanceDaily(employeeId, dayStr, status) {
  try {
    const { error } = await supabase.from('attendance_daily').upsert(
      {
        employee_id: employeeId,
        day: dayStr,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,day' },
    );
    if (error && !/relation|does not exist|schema|permission/i.test(String(error.message || ''))) {
      console.warn('attendance_daily:', error.message);
    }
  } catch (e) {
    console.warn('attendance_daily upsert', e);
  }
}

// ── Patch employee with fallback for missing columns ──────────────────────────
export async function patchEmployee(id, fields) {
  let attempt = { ...fields };
  let { error } = await supabase.from('employees').update(attempt).eq('id', id);
  if (error && Object.prototype.hasOwnProperty.call(attempt, 'last_check_in_at') && /last_check_in_at|column|schema/i.test(String(error.message || ''))) {
    delete attempt.last_check_in_at;
    ({ error } = await supabase.from('employees').update(attempt).eq('id', id));
  }
  if (!error) {
    const { data: row } = await supabase.from('employees').select('*').eq('id', id).maybeSingle();
    if (row) {
      const merged = { ...row, ...attempt };
      const disp = deriveDisplayStatus(merged, new Date());
      await upsertAttendanceDaily(id, localDateStr(new Date()), disp);
    }
  }
  return { error };
}

// ── Patch admin ─────────────────────────────────────────────────────────────
export async function patchAdmin(id, fields) {
  const { error } = await supabase.from('admins').update(fields).eq('id', id);
  return { error };
}


// ── IP helpers ────────────────────────────────────────────────────────────────
export function ipStorageKey(username, role) {
  return `syncorg_last_ip_${role}_${username.trim().toLowerCase()}`;
}

export async function fetchClientIp() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ip ? String(j.ip) : null;
  } catch {
    return null;
  }
}

export function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [u, d] = email.split('@');
  const vis = u.length <= 2 ? u[0] + '••' : u.slice(0, 2) + '•••' + u.slice(-1);
  return `${vis}@${d}`;
}

// ── App base URL (for QR redirects, OAuth) ────────────────────────────────────
export function getAppBaseUrl() {
  const origin = window.location.origin;
  const url = origin.endsWith('/') ? origin : origin + '/';
  return url;
}

// ── Monthly attendance for charts ─────────────────────────────────────────────
export function buildMonthlyAttendanceShell() {
  const monthKeys = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString(undefined, { month: 'short' }),
    });
  }
  return {
    monthKeys,
    emptyResult: () => ({
      labels: monthKeys.map((m) => m.label),
      series: monthKeys.map(() => ({ present: 0, late: 0, absent: 0, excused: 0 })),
    }),
  };
}

export async function fetchMonthlyAttendanceFromSupabase() {
  const start = new Date();
  start.setMonth(start.getMonth() - 5);
  start.setDate(1);
  const fromStr = localDateStr(start);
  const { data, error } = await supabase.from('attendance_daily').select('day,status').gte('day', fromStr);
  const { monthKeys, emptyResult } = buildMonthlyAttendanceShell();
  if (error) return null;
  if (!data || !data.length) return emptyResult();

  const bucket = {};
  monthKeys.forEach((m) => { bucket[m.key] = { present: 0, late: 0, absent: 0, excused: 0 }; });
  data.forEach((row) => {
    const d = row.day ? String(row.day).slice(0, 10) : '';
    if (!d) return;
    const mk = d.slice(0, 7);
    if (!bucket[mk]) return;
    const st = row.status;
    if (st === 'Present') bucket[mk].present += 1;
    else if (st === 'Late') bucket[mk].late += 1;
    else if (st === 'Absent') bucket[mk].absent += 1;
    else if (st === 'Excused') bucket[mk].excused += 1;
  });
  return {
    labels: monthKeys.map((m) => m.label),
    series: monthKeys.map((m) => bucket[m.key]),
  };
}

// ── Signup error formatting ───────────────────────────────────────────────────
export function formatSignupDbError(err) {
  const msg = (err && (err.message || err.details)) ? String(err.message || err.details) : String(err || '');
  const code = err && err.code;
  if (code === '23505' || /duplicate key/i.test(msg)) {
    if (/username/i.test(msg)) return 'That username is already registered.';
    if (/email/i.test(msg)) return 'That email is already registered.';
    if (/emp_id/i.test(msg)) return 'That student / employee ID is already registered.';
  }
  return msg || 'Something went wrong.';
}

// ── Fetch unified recent activity feed ────────────────────────────────────────
export async function fetchRecentActivities() {
  try {
    // Try to fetch latest 6 attendance entries with joined employee info
    // (Joining depends on FK relationships in Supabase)
    const { data: att } = await supabase
      .from('attendance_daily')
      .select('status, updated_at, employees(full_name, avatar_url)')
      .order('updated_at', { ascending: false })
      .limit(6);

    const { data: exc } = await supabase
      .from('excuse_requests')
      .select('status, created_at, employees(full_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(6);

    const attItems = (att || []).map(a => ({
      name: a.employees?.full_name || 'Student',
      avatar: a.employees?.avatar_url,
      action: `marked ${a.status}`,
      time: a.updated_at
    }));

    const excItems = (exc || []).map(e => ({
      name: e.employees?.full_name || 'Student',
      avatar: e.employees?.avatar_url,
      action: 'submitted Excuse',
      time: e.created_at
    }));

    // Sort by timestamp desc
    return [...attItems, ...excItems]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 6);
  } catch (err) {
    console.error('Activity fetch failed:', err);
    return [];
  }
}


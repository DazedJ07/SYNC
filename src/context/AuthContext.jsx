import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  supabase, ORG_SECRET, deriveDisplayStatus, patchEmployee, fetchClientIp,
  ipStorageKey, maskEmail, getAppBaseUrl, formatSignupDbError
} from '../lib/supabase.js';

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingCheckin, setPendingCheckin] = useState(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('sync_session');
    if (saved && !currentUser) {
      try {
        const { id, type } = JSON.parse(saved);
        const table = type === 'admin' ? 'admins' : 'employees';
        supabase.from(table).select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
          if (data && !error) {
            setCurrentUser({ ...data, accountType: type });
          } else {
            localStorage.removeItem('sync_session');
          }
        });
      } catch { localStorage.removeItem('sync_session'); }
    }
  }, []); // eslint-disable-line


  // Check URL params for QR-based checkin on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const token = params.get('token');
    const expires = params.get('expires');

    if (action === 'checkin' && token && expires) {
      // Clean URL
      const url = new URL(window.location);
      url.searchParams.delete('action');
      url.searchParams.delete('token');
      url.searchParams.delete('expires');
      window.history.replaceState({}, '', url);

      if (Date.now() > parseInt(expires, 10)) {
        // Expired — will show alert on login page
        setPendingCheckin({ expired: true });
      } else {
        setPendingCheckin({ token, expires });
        sessionStorage.setItem('pending_checkin', JSON.stringify({ token, expires }));
      }
    } else {
      // Check sessionStorage for pending checkin after page reload
      const stored = sessionStorage.getItem('pending_checkin');
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (Date.now() < parseInt(data.expires, 10)) {
            setPendingCheckin(data);
          } else {
            sessionStorage.removeItem('pending_checkin');
          }
        } catch { sessionStorage.removeItem('pending_checkin'); }
      }
    }
  }, []);

  // Process student checkin after login
  const processStudentCheckin = useCallback(async (user) => {
    if (!user || user.accountType !== 'student') return false;
    const pending = sessionStorage.getItem('pending_checkin');
    if (!pending) return false;

    try {
      const data = JSON.parse(pending);
      if (Date.now() >= parseInt(data.expires, 10)) {
        sessionStorage.removeItem('pending_checkin');
        setPendingCheckin(null);
        return false;
      }

      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const st = mins > 8 * 60 + 30 ? 'Late' : 'Present';

      const { error } = await patchEmployee(user.id, {
        status: st,
        shift_status: 'On-Shift',
        last_check_in_at: now.toISOString(),
        shift_seconds: 0
      });

      sessionStorage.removeItem('pending_checkin');
      setPendingCheckin(null);

      if (error) {
        console.error('Checkin failed:', error.message);
        return false;
      }
      return true; // Success — caller shows toast
    } catch {
      sessionStorage.removeItem('pending_checkin');
      setPendingCheckin(null);
      return false;
    }
  }, []);

  // Password login
  const login = useCallback(async (identifier, password) => {
    // Try admins first
    let res = await supabase.from('admins')
      .select('*')
      .eq('password', password)
      .or(`email.eq."${identifier}",username.eq."${identifier}",admin_name.eq."${identifier}"`)
      .maybeSingle();
    let role = 'admin';

    if (!res.data) {
      res = await supabase.from('employees')
        .select('*')
        .eq('password', password)
        .or(`email.eq."${identifier}",username.eq."${identifier}",full_name.eq."${identifier}"`)
        .maybeSingle();
      role = 'student';
    }

    if (!res.data) throw new Error('Account not found. Please check credentials.');

    const clientIp = await fetchClientIp();
    const key = ipStorageKey(identifier, role);
    const prevIp = localStorage.getItem(key);
    const ipChanged = Boolean(clientIp && prevIp && prevIp !== clientIp);
    const hasEmail = Boolean(res.data.email && String(res.data.email).trim());

    if (ipChanged && hasEmail) {
      // Need OTP verification
      return { needsOtp: true, userData: res.data, role, clientIp, email: res.data.email };
    }

    // Direct login
    if (clientIp) localStorage.setItem(key, clientIp);
    const user = { ...res.data, accountType: role };
    localStorage.setItem('sync_session', JSON.stringify({ id: user.id, type: role }));
    setCurrentUser(user);
    return { success: true, user };
  }, []);

  // Send OTP for login verification
  const sendLoginOtp = useCallback(async (email) => {
    await supabase.auth.signOut().catch(() => {});
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: getAppBaseUrl() },
    });
    if (error) throw new Error(error.message || 'Could not send verification email.');
  }, []);

  // Verify OTP and complete login
  const verifyLoginOtp = useCallback(async (email, token, userData, role, identifier) => {
    const { error: vErr } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (vErr) throw new Error(vErr.message || 'Invalid or expired code.');
    await supabase.auth.signOut().catch(() => {});

    const clientIp = await fetchClientIp();
    const key = ipStorageKey(identifier, role);
    if (clientIp) localStorage.setItem(key, clientIp);

    const user = { ...userData, accountType: role };
    localStorage.setItem('sync_session', JSON.stringify({ id: user.id, type: role }));
    setCurrentUser(user);
    return user;
  }, []);

  // Signup flow
  const sendSignupOtp = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: getAppBaseUrl() },
    });
    if (error) throw new Error(error.message || 'Could not send verification email.');
  }, []);

  const completeSignup = useCallback(async ({ role, name, email, username, password, orgId, empId, phone, otpToken }) => {
    // Verify OTP
    const { error: vErr } = await supabase.auth.verifyOtp({ email, token: otpToken, type: 'email' });
    if (vErr) throw new Error(vErr.message || 'Invalid or expired code.');

    if (role === 'admin') {
      if (orgId !== ORG_SECRET) throw new Error('Invalid organization code.');
      const phoneVal = phone && phone.trim() !== '' ? phone.trim() : null;
      const { error } = await supabase.from('admins').insert([{
        org_id: orgId, admin_name: name, email, username, password, phone: phoneVal
      }]);
      if (error) throw error;
    } else {
      const phoneVal = phone && phone.trim() !== '' ? phone.trim() : null;
      const { error } = await supabase.from('employees').insert([{
        emp_id: empId, full_name: name, email, phone: phoneVal, department: 'Student',
        role: 'Student Employee', status: 'No Record', username, password,
        shift_status: 'Off-Shift', shift_seconds: 0, batch: 'Batch 1', team: 'Unassigned', bio: ''
      }]);
      if (error) throw error;
    }

    await supabase.auth.signOut();
    return true;
  }, []);

  // Check if identifiers are free before signup
  const assertIdentifiersFree = useCallback(async (username, email, empId, isAdmin) => {
    if (isAdmin) {
      const { data: du } = await supabase.from('admins').select('id').eq('username', username).maybeSingle();
      if (du) throw new Error('That admin username is already taken.');
      const { data: de } = await supabase.from('admins').select('id').eq('email', email).maybeSingle();
      if (de) throw new Error('That email is already registered for an admin.');
    } else {
      const { data: du } = await supabase.from('employees').select('id').eq('username', username).maybeSingle();
      if (du) throw new Error('That username is already taken.');
      const { data: de } = await supabase.from('employees').select('id').eq('email', email).maybeSingle();
      if (de) throw new Error('That email is already registered.');
      const { data: di } = await supabase.from('employees').select('id').eq('emp_id', empId).maybeSingle();
      if (di) throw new Error('That student / employee ID is already registered.');
    }
  }, []);

  // Google OAuth
  const signInWithGoogle = useCallback(async () => {
    const redirectTo = getAppBaseUrl();
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw new Error(error.message || 'Google sign-in failed.');
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const handleOAuth = async (session) => {
      if (currentUser || !session?.user?.email) return;
      const rawEmail = String(session.user.email).trim();
      const { data: admin } = await supabase.from('admins').select('*').eq('email', rawEmail).maybeSingle();
      if (admin) {
        await supabase.auth.signOut().catch(() => {});
        const user = { ...admin, accountType: 'admin' };
        localStorage.setItem('sync_session', JSON.stringify({ id: user.id, type: 'admin' }));
        setCurrentUser(user);
        return;
      }
      const { data: emp } = await supabase.from('employees').select('*').eq('email', rawEmail).maybeSingle();
      if (emp) {
        await supabase.auth.signOut().catch(() => {});
        const user = { ...emp, accountType: 'student' };
        localStorage.setItem('sync_session', JSON.stringify({ id: user.id, type: 'student' }));
        setCurrentUser(user);
        return;
      }
      await supabase.auth.signOut().catch(() => {});
    };

    supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        handleOAuth(session);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleOAuth(session);
    });
  }, [currentUser]);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem('sync_session');
    setCurrentUser(null);
    supabase.auth.signOut().catch(() => {});
  }, []);

  // Update user data (for profile edits)
  const updateCurrentUser = useCallback((updates) => {
    setCurrentUser(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  // ── Shift Management ──────────────────────────────────────────────────────────
  const toggleShiftStatus = useCallback(async (user) => {
    if (!user || user.accountType !== 'student') return { error: { message: 'Not a student' } };
    const now = new Date();
    const isPaused = user.shift_status === 'Paused';
    const isOnShift = user.shift_status === 'On-Shift';

    let updates = {};
    if (isOnShift) {
      // On-Shift -> Paused
      const elapsed = Math.max(0, Math.floor((now - new Date(user.last_check_in_at)) / 1000));
      updates = {
        shift_status: 'Paused',
        shift_seconds: (user.shift_seconds || 0) + elapsed
      };
    } else if (isPaused) {
      // Paused -> On-Shift
      updates = {
        shift_status: 'On-Shift',
        last_check_in_at: now.toISOString()
      };
    } else {
      // Off-Shift -> On-Shift (forced start if needed, but QR covers this usually)
      updates = {
        shift_status: 'On-Shift',
        last_check_in_at: now.toISOString(),
        shift_seconds: 0
      };
    }

    const { error } = await patchEmployee(user.id, updates);
    if (!error) setCurrentUser(prev => ({ ...prev, ...updates }));
    return { error };
  }, []);

  const endShift = useCallback(async (user) => {
    if (!user || user.accountType !== 'student') return { error: { message: 'Not a student' } };
    const updates = {
      shift_status: 'Off-Shift',
      shift_seconds: 0
    };
    const { error } = await patchEmployee(user.id, updates);
    if (!error) setCurrentUser(prev => ({ ...prev, ...updates }));
    return { error };
  }, []);


  return (
    <AuthContext.Provider value={{
      currentUser, isLoading, pendingCheckin,
      login, logout, sendLoginOtp, verifyLoginOtp,
      sendSignupOtp, completeSignup, assertIdentifiersFree,
      signInWithGoogle, processStudentCheckin, updateCurrentUser,
      toggleShiftStatus, endShift,
      setCurrentUser, setPendingCheckin,
      supabase, ORG_SECRET
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

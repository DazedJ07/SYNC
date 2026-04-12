// ================================================================================

import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import { Html5QrcodeScanner } from 'html5-qrcode';
import gsap from 'gsap';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';

document.addEventListener('DOMContentLoaded', () => {

    const THEME_KEY = 'syncorg-theme';

    function applyTheme(theme) {
        const t = theme === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
        try {
            localStorage.setItem(THEME_KEY, t);
        } catch (e) { /* ignore */ }
        const loginLbl = document.getElementById('login-theme-label');
        if (loginLbl) loginLbl.textContent = t === 'dark' ? 'Dark' : 'Light';
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        });
        document.dispatchEvent(new CustomEvent('syncorg-themechange', { detail: { theme: t } }));
    }

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            applyTheme(cur === 'dark' ? 'light' : 'dark');
        });
    });
    (function syncInitialThemeUi() {
        const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const loginLbl = document.getElementById('login-theme-label');
        if (loginLbl) loginLbl.textContent = t === 'dark' ? 'Dark' : 'Light';
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        });
    })();

    // ==================== SUPABASE CONFIGURATION ====================
    // These credentials connect to your Supabase project
    // Supabase is a PostgreSQL database backend with built-in authentication
    //
    // TO CHANGE DATABASE:
    // 1. Create new Supabase project at supabase.com
    // 2. Get URL and API Key from project Settings > API
    // 3. Replace SUPABASE_URL and SUPABASE_KEY below
    // 4. Auth → Email Templates → Magic link: include {{ .Token }} for 6-digit OTP emails (see Supabase passwordless email docs).
    // 5. Database: 'admins' and 'employees' tables as below
    //
    // TABLE SCHEMA:
    // admins: {id, org_id, admin_name, email, username, password, avatar_url}
    // employees: {id, emp_id, full_name, email, phone?, department, role, status,
    //             username, password, shift_status, shift_seconds, batch,
    //             team, bio, avatar_url}
    
    const SUPABASE_URL = 'https://yhiqtdgoeuctpybvjbrc.supabase.co'; 
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloaXF0ZGdvZXVjdHB5YnZqYnJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjIyOTMsImV4cCI6MjA5MTE5ODI5M30.4hjObsvtcrm5GRZ9MvA31xfgTqwHoalkuWa_5R9itrg';

    // Supabase email OTP: Dashboard → Auth → Email Templates → Magic Link must include {{ .Token }} for 6-digit codes.
    const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

    /** Pending signup row data after Supabase sends the verification email (code verified server-side). */
    let pendingSignupPayload = null;
    let lastSignupOtpSendAt = 0;

    /** When IP changes at login, we verify email via Supabase before finishing session. */
    let pendingLoginAfterOtp = null;
    let lastLoginOtpSendAt = 0;

    function ipStorageKey(username, role) {
        return `syncorg_last_ip_${role}_${username.trim().toLowerCase()}`;
    }

    async function fetchClientIp() {
        try {
            const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
            if (!r.ok) return null;
            const j = await r.json();
            return j && j.ip ? String(j.ip) : null;
        } catch {
            return null;
        }
    }

    function maskEmail(email) {
        if (!email || !email.includes('@')) return email || '';
        const [u, d] = email.split('@');
        const vis = u.length <= 2 ? u[0] + '••' : u.slice(0, 2) + '•••' + u.slice(-1);
        return `${vis}@${d}`;
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    /** After Google OAuth redirect: map Supabase user email → admins/employees row and open dashboard. */
    async function tryMapOAuthToPortal(session) {
        if (currentUser || !session?.user?.email) return;
        const rawEmail = String(session.user.email).trim();

        const { data: admin } = await supabase.from('admins').select('*').eq('email', rawEmail).maybeSingle();
        if (admin) {
            await supabase.auth.signOut().catch(() => {});
            currentUser = { ...admin, accountType: 'admin' };
            initDashboard();
            return;
        }

        const { data: emp } = await supabase.from('employees').select('*').eq('email', rawEmail).maybeSingle();
        if (emp) {
            await supabase.auth.signOut().catch(() => {});
            currentUser = { ...emp, accountType: 'student' };
            initDashboard();
            return;
        }

        const errBox = document.getElementById('login-error');
        if (errBox) {
            errBox.innerText =
                'This Google account is not linked to a portal profile. Sign in with username and password, or ask an admin to use the same email in SYNC.';
            errBox.classList.remove('hidden');
        }
        await supabase.auth.signOut().catch(() => {});
    }

    supabase.auth.onAuthStateChange((event, session) => {
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
            tryMapOAuthToPortal(session);
        }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) tryMapOAuthToPortal(session);
    });

    // ==================== QR + SPOTLIGHT VIRTUAL ID HELPERS ====================
    const SPOTLIGHT_COLOR = 'rgba(0, 229, 255, 0.22)';
    const ATT_DYNAMIC_TTL_MS = 45 * 1000;
    const ATT_DYNAMIC_REFRESH_MS = 25 * 1000;
    let attendanceQrInterval = null;

    function bindCardSpotlights() {
        document.querySelectorAll('.card-spotlight').forEach((el) => {
            if (el._spotlightBound) return;
            el._spotlightBound = true;
            el.style.setProperty('--spotlight-color', SPOTLIGHT_COLOR);
            el.addEventListener('mousemove', (e) => {
                const rect = el.getBoundingClientRect();
                el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
                el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
            });
        });
    }

    function setQrOnImage(imgEl, data, size = 200) {
        if (!imgEl) return;
        const str = String(data ?? '');
        if (!str) {
            imgEl.removeAttribute('src');
            return;
        }
        const enc = encodeURIComponent(str);
        const primary = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${enc}`;
        const fallback = `https://quickchart.io/qr?text=${enc}&size=${size}&margin=2`;
        imgEl.onerror = function () {
            imgEl.onerror = null;
            imgEl.src = fallback;
        };
        imgEl.src = primary;
    }

    function buildRollingAttendancePayload(empId) {
        const exp = Date.now() + ATT_DYNAMIC_TTL_MS;
        return `SYNC_ORG|${empId}|${exp}`;
    }

    function renderDynamicAttendanceQr() {
        const img = document.getElementById('dynamic-attendance-qr');
        const timerEl = document.getElementById('qr-timer-text');
        if (!img || !currentUser || currentUser.accountType !== 'student') return;
        const empId = currentUser.emp_id || 'EV-000';
        setQrOnImage(img, buildRollingAttendancePayload(empId), 140);
        let sec = Math.ceil(ATT_DYNAMIC_REFRESH_MS / 1000);
        if (timerEl) timerEl.textContent = `Refreshes in ${sec}s`;
        if (window._qrTimerCountdown) clearInterval(window._qrTimerCountdown);
        window._qrTimerCountdown = setInterval(() => {
            sec -= 1;
            if (timerEl) timerEl.textContent = sec > 0 ? `Refreshes in ${sec}s` : 'Refreshing…';
            if (sec <= 0) {
                clearInterval(window._qrTimerCountdown);
                window._qrTimerCountdown = null;
            }
        }, 1000);
    }

    function startDynamicAttendanceQr() {
        stopDynamicAttendanceQr();
        if (!currentUser || currentUser.accountType !== 'student') return;
        renderDynamicAttendanceQr();
        attendanceQrInterval = setInterval(renderDynamicAttendanceQr, ATT_DYNAMIC_REFRESH_MS);
    }

    function stopDynamicAttendanceQr() {
        if (attendanceQrInterval) {
            clearInterval(attendanceQrInterval);
            attendanceQrInterval = null;
        }
        if (window._qrTimerCountdown) {
            clearInterval(window._qrTimerCountdown);
            window._qrTimerCountdown = null;
        }
    }

    /** Admin scanner: rolling attendance QR or legacy plain emp_id. */
    function parseScannedAttendancePayload(text) {
        const raw = String(text || '').trim();
        const parts = raw.split('|');
        if (parts.length >= 3 && parts[0] === 'SYNC_ORG') {
            const empId = parts[1];
            const exp = parseInt(parts[2], 10);
            if (!Number.isFinite(exp)) return { error: 'bad_format' };
            if (Date.now() > exp) return { error: 'expired', empId };
            return { empId };
        }
        return { empId: raw };
    }

    function escJsQuoted(s) {
        return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // ==================== GLOBAL STATE VARIABLES ====================
    // These variables track the current state of the application
    let currentUser = null;              // Stores logged-in user data {id, name, role, accountType, etc.}
    let allEmployees = [];               // Cache of all employees for fast access
    let activityFeedLogs = [];           // Array of activity feed entries for display
    let shiftInterval = null;            // Timer reference for real-time shift updates
    let calendarDate = new Date();       // Current date being viewed in calendar
    let html5QrcodeScanner = null;       // QR scanner instance reference

    // ==================== UI LOGIN PAGE CONTROLS ====================
    // Manages switching between Sign In and Sign Up form views
    // Uses CSS transform to slide forms in/out
    
    const loginBox = document.getElementById('container');
    
    // Show Sign Up form when user clicks "Sign Up" button
    document.getElementById('signUp').addEventListener('click', () => {
        loginBox.classList.add("right-panel-active");
    });
    
    // Show Sign In form when user clicks "Sign In" button
    document.getElementById('signIn').addEventListener('click', () => {
        loginBox.classList.remove("right-panel-active");
    });

    const loginGoogleBtn = document.getElementById('login-google-btn');
    if (loginGoogleBtn) {
        loginGoogleBtn.addEventListener('click', async () => {
            const errBox = document.getElementById('login-error');
            if (errBox) errBox.classList.add('hidden');
            const redirectTo = `${window.location.origin}${window.location.pathname}`;
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo },
            });
            if (error) {
                if (errBox) {
                    errBox.innerText = error.message || 'Google sign-in failed.';
                    errBox.classList.remove('hidden');
                }
            }
        });
    }

    // ==================== ROLE-BASED FORM FIELD VISIBILITY ====================
    // Show/hide organization ID or student ID based on selected role
    const signupAdminRadio = document.getElementById('signup-admin');
    document.getElementById('signup-admin').addEventListener('change', updateSignupFields);
    document.getElementById('signup-student').addEventListener('change', updateSignupFields);

    /**
     * Updates signup form visibility based on selected role
     * Admin sees: Organization ID field
     * Student sees: Student/Employee ID field
     * */
    function updateSignupFields() {
        if (signupAdminRadio.checked) {
            document.getElementById('group-org-id').classList.remove('hidden');     // Show Org ID for admin
            document.getElementById('group-student-id').classList.add('hidden');    // Hide Student ID
        } else {
            document.getElementById('group-org-id').classList.add('hidden');        // Hide Org ID
            document.getElementById('group-student-id').classList.remove('hidden'); // Show Student ID
        }
    }

    // ==================== AUTHENTICATION LOGIC ====================
    // ==================== STEPPER SIGNUP HANDLER ====================
    // Multi-step signup: Choose Role -> Enter Details -> Complete
    
    let stepperCurrentStep = 1;
    const STEPPER_TOTAL_STEPS = 3;
    
    function updateStepperUI() {
        // Show/hide step content
        for (let i = 1; i <= STEPPER_TOTAL_STEPS; i++) {
            const stepEl = document.getElementById(`stepper-step-${i}`);
            if (stepEl) stepEl.classList.toggle('hidden', i !== stepperCurrentStep);
        }
        
        // Update step indicators
        const indicators = document.querySelectorAll('.step-indicator');
        indicators.forEach(ind => {
            const stepNum = parseInt(ind.dataset.step);
            const inner = ind.querySelector('.step-indicator-inner');
            if (!inner) return;
            inner.className = 'step-indicator-inner';
            if (stepNum < stepperCurrentStep) {
                inner.classList.add('complete');
                inner.innerHTML = '<svg class="step-check-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
            } else if (stepNum === stepperCurrentStep) {
                inner.classList.add('active');
                inner.innerHTML = '<div class="step-active-dot"></div>';
            } else {
                inner.classList.add('inactive');
                inner.innerHTML = `<span class="step-number">${stepNum}</span>`;
            }
        });
        
        // Update connectors
        const conn12 = document.getElementById('conn-1-2');
        const conn23 = document.getElementById('conn-2-3');
        if (conn12) conn12.classList.toggle('complete', stepperCurrentStep > 1);
        if (conn23) conn23.classList.toggle('complete', stepperCurrentStep > 2);
        
        // Update buttons
        const backBtn = document.getElementById('stepper-back-btn');
        const nextBtn = document.getElementById('stepper-next-btn');
        const navEl = document.getElementById('stepper-nav');
        if (backBtn) backBtn.classList.toggle('hidden', stepperCurrentStep === 1);
        if (navEl) navEl.className = `stepper-footer-nav ${stepperCurrentStep > 1 ? 'spread' : 'end'}`;
        if (nextBtn) nextBtn.innerText = stepperCurrentStep === STEPPER_TOTAL_STEPS ? 'Create account' : 'Next';
        
        // Hide error on step change
        const errBox = document.getElementById('signup-error');
        if (errBox) errBox.classList.add('hidden');
    }
    
    function validateStep(step) {
        const errBox = document.getElementById('signup-error');
        if (step === 1) {
            const isAdmin = signupAdminRadio.checked;
            if (isAdmin) {
                const orgId = document.getElementById('reg-org-id').value.trim();
                if (!orgId) { errBox.innerText = 'Please enter your Organization ID.'; errBox.classList.remove('hidden'); return false; }
            } else {
                const studentId = document.getElementById('reg-student-id').value.trim();
                if (!studentId) { errBox.innerText = 'Please enter your Student ID.'; errBox.classList.remove('hidden'); return false; }
            }
        }
        if (step === 2) {
            const name = document.getElementById('reg-name').value.trim();
            const user = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const pass = document.getElementById('reg-password').value.trim();
            if (!name || !user || !email || !pass) {
                errBox.innerText = 'Please fill in all fields.'; errBox.classList.remove('hidden'); return false;
            }
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            if (!emailOk) {
                errBox.innerText = 'Please enter a valid email address.'; errBox.classList.remove('hidden'); return false;
            }
        }
        return true;
    }

    let signupCompleteInFlight = false;

    /** Postgres unique / PK violations → readable copy; includes fix for desynced serial on `id`. */
    function formatSignupDbError(err) {
        const msg = (err && (err.message || err.details)) ? String(err.message || err.details) : String(err || '');
        const code = err && err.code;
        if (code === '23505' || /duplicate key/i.test(msg)) {
            if (/employees_pkey/i.test(msg)) {
                return 'Could not create the employee row: the next ID collides with an existing row. This usually means the employees id sequence is out of sync (e.g. after importing data). In Supabase → SQL Editor run:\n\nselect setval(pg_get_serial_sequence(\'employees\', \'id\'), coalesce((select max(id) from employees), 1));\n\nThen try Create account again. If Supabase Auth already created the user for this email, delete that auth user first or use a different email.';
            }
            if (/admins_pkey/i.test(msg)) {
                return 'Could not create the admin row: id sequence out of sync. In Supabase → SQL Editor run:\n\nselect setval(pg_get_serial_sequence(\'admins\', \'id\'), coalesce((select max(id) from admins), 1));\n\nThen try again.';
            }
            if (/username/i.test(msg)) return 'That username is already registered.';
            if (/email/i.test(msg)) return 'That email is already registered.';
            if (/emp_id/i.test(msg)) return 'That student / employee ID is already registered.';
        }
        return msg || 'Something went wrong.';
    }

    /** Before sending OTP: avoid wasted verification if username/email/emp_id already exists. */
    async function assertSignupIdentifiersFree() {
        const user = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        if (signupAdminRadio.checked) {
            const { data: du } = await supabase.from('admins').select('id').eq('username', user).maybeSingle();
            if (du) throw new Error('That admin username is already taken.');
            const { data: de } = await supabase.from('admins').select('id').eq('email', email).maybeSingle();
            if (de) throw new Error('That email is already registered for an admin.');
            return;
        }
        const empId = document.getElementById('reg-student-id').value.trim();
        const { data: du } = await supabase.from('employees').select('id').eq('username', user).maybeSingle();
        if (du) throw new Error('That username is already taken.');
        const { data: de } = await supabase.from('employees').select('id').eq('email', email).maybeSingle();
        if (de) throw new Error('That email is already registered.');
        const { data: di } = await supabase.from('employees').select('id').eq('emp_id', empId).maybeSingle();
        if (di) throw new Error('That student / employee ID is already registered.');
    }

    async function sendSignupSupabaseOtp(isResend = false) {
        const now = Date.now();
        if (isResend && now - lastSignupOtpSendAt < OTP_RESEND_COOLDOWN_MS && lastSignupOtpSendAt > 0) {
            const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - lastSignupOtpSendAt)) / 1000);
            throw new Error(`Please wait ${wait}s before requesting another code.`);
        }
        const email = document.getElementById('reg-email').value.trim();
        const name = document.getElementById('reg-name').value.trim();
        const user = document.getElementById('reg-username').value.trim();
        const pass = document.getElementById('reg-password').value;
        const role = signupAdminRadio.checked ? 'admin' : 'student';
        const orgId = document.getElementById('reg-org-id').value.trim();
        const empId = document.getElementById('reg-student-id').value.trim();

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });
        if (error) throw new Error(error.message || 'Could not send verification email.');

        lastSignupOtpSendAt = Date.now();
        pendingSignupPayload = { role, name, email, user, pass, orgId, empId };
    }

    function validateOtpInputFormat() {
        const errBox = document.getElementById('signup-error');
        const input = document.getElementById('reg-otp').value.trim().replace(/\s+/g, '');
        if (!input || input.length < 6) {
            errBox.innerText = 'Enter the 6-digit code from your email.';
            errBox.classList.remove('hidden');
            return false;
        }
        if (!pendingSignupPayload) {
            errBox.innerText = 'No active verification. Go back to the previous step and continue again.';
            errBox.classList.remove('hidden');
            return false;
        }
        return true;
    }

    async function completeSignup() {
        const nextBtn = document.getElementById('stepper-next-btn');
        const errBox = document.getElementById('signup-error');
        if (!validateOtpInputFormat()) return;
        if (signupCompleteInFlight) return;
        signupCompleteInFlight = true;
        nextBtn.disabled = true;

        const token = document.getElementById('reg-otp').value.trim().replace(/\s+/g, '');
        const d = pendingSignupPayload;
        const role = d.role;
        const name = d.name;
        const email = d.email;
        const user = d.user;
        const pass = d.pass;

        nextBtn.innerText = 'Processing...';

        try {
            const { error: vErr } = await supabase.auth.verifyOtp({
                email,
                token,
                type: 'email',
            });
            if (vErr) throw new Error(vErr.message || 'Invalid or expired code.');

            if (role === 'admin') {
                const orgId = d.orgId;
                if (orgId !== '2026') throw new Error('Invalid Org ID.');
                const { error } = await supabase.from('admins').insert([{ org_id: orgId, admin_name: name, email, username: user, password: pass }]);
                if (error) throw error;
            } else {
                const empIdVal = d.empId;
                const { error } = await supabase.from('employees').insert([{ emp_id: empIdVal, full_name: name, email, department: 'Student', role: 'Student Employee', status: 'Absent', username: user, password: pass, shift_status: 'Off-Shift', shift_seconds: 0, batch: 'Batch 1', team: 'Unassigned', bio: '' }]);
                if (error) throw error;
            }

            await supabase.auth.signOut();

            alert('Account created successfully!');
            loginBox.classList.remove('right-panel-active');
            pendingSignupPayload = null;
            stepperCurrentStep = 1;
            updateStepperUI();
            document.getElementById('reg-name').value = '';
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-username').value = '';
            document.getElementById('reg-password').value = '';
            document.getElementById('reg-org-id').value = '';
            const studentIdEl = document.getElementById('reg-student-id');
            if (studentIdEl) studentIdEl.value = '';
            const otpEl = document.getElementById('reg-otp');
            if (otpEl) otpEl.value = '';
        } catch (err) {
            errBox.innerText = formatSignupDbError(err);
            errBox.classList.remove('hidden');
        } finally {
            signupCompleteInFlight = false;
            nextBtn.disabled = false;
            nextBtn.innerText = stepperCurrentStep === STEPPER_TOTAL_STEPS ? 'Create account' : 'Next';
        }
    }
    
    // Stepper button handlers
    const stepperNextBtn = document.getElementById('stepper-next-btn');
    if (stepperNextBtn) {
        stepperNextBtn.addEventListener('click', async () => {
            if (stepperCurrentStep < STEPPER_TOTAL_STEPS) {
                if (!validateStep(stepperCurrentStep)) return;
                if (stepperCurrentStep === 2) {
                    const nextBtn = document.getElementById('stepper-next-btn');
                    const errBox = document.getElementById('signup-error');
                    errBox.classList.add('hidden');
                    nextBtn.disabled = true;
                    nextBtn.innerText = 'Sending…';
                    try {
                        await assertSignupIdentifiersFree();
                        await sendSignupSupabaseOtp(false);
                        stepperCurrentStep++;
                        const disp = document.getElementById('otp-email-display');
                        if (disp) disp.textContent = document.getElementById('reg-email').value.trim();
                        updateStepperUI();
                    } catch (err) {
                        errBox.innerText = err.message || 'Could not send verification email.';
                        errBox.classList.remove('hidden');
                    } finally {
                        nextBtn.disabled = false;
                        nextBtn.innerText = stepperCurrentStep === STEPPER_TOTAL_STEPS ? 'Create account' : 'Next';
                    }
                    return;
                }
                stepperCurrentStep++;
                updateStepperUI();
            } else {
                completeSignup();
            }
        });
    }

    const signupResendOtp = document.getElementById('signup-resend-otp');
    if (signupResendOtp) {
        signupResendOtp.addEventListener('click', async () => {
            if (stepperCurrentStep !== 3) return;
            const errBox = document.getElementById('signup-error');
            errBox.classList.add('hidden');
            signupResendOtp.disabled = true;
            try {
                await sendSignupSupabaseOtp(true);
                errBox.innerText = 'A new code has been sent.';
                errBox.classList.remove('hidden');
                errBox.classList.add('signup-success-msg');
                setTimeout(() => {
                    errBox.classList.add('hidden');
                    errBox.classList.remove('signup-success-msg');
                }, 4000);
            } catch (e) {
                errBox.innerText = e.message || 'Resend failed.';
                errBox.classList.remove('hidden');
            } finally {
                signupResendOtp.disabled = false;
            }
        });
    }
    
    const stepperBackBtn = document.getElementById('stepper-back-btn');
    if (stepperBackBtn) {
        stepperBackBtn.addEventListener('click', () => {
            if (stepperCurrentStep > 1) {
                if (stepperCurrentStep === 3) {
                    pendingSignupPayload = null;
                    supabase.auth.signOut().catch(() => {});
                }
                stepperCurrentStep--;
                updateStepperUI();
            }
        });
    }

    // ==================== LOGIN HANDLER ====================
    // Password check against admins/employees; if public IP changed since last login, require Supabase email OTP.

    const loginForm = document.getElementById('login-form');
    const loginOtpPanel = document.getElementById('login-otp-panel');
    const loginOtpInput = document.getElementById('login-otp-input');
    const loginOtpError = document.getElementById('login-otp-error');
    const loginOtpEmailDisplay = document.getElementById('login-otp-email-display');
    const loginOtpVerifyBtn = document.getElementById('login-otp-verify-btn');
    const loginOtpResendBtn = document.getElementById('login-otp-resend-btn');
    const loginOtpCancelBtn = document.getElementById('login-otp-cancel-btn');

    function setLoginOtpPanelVisible(visible) {
        if (!loginOtpPanel || !loginForm) return;
        loginOtpPanel.classList.toggle('hidden', !visible);
        loginForm.classList.toggle('login-form-dimmed', visible);
        const inputs = loginForm.querySelectorAll('input, button[type="submit"], .btn-google');
        inputs.forEach((el) => {
            el.disabled = visible;
        });
        if (visible) {
            loginOtpError.classList.add('hidden');
            if (loginOtpInput) {
                loginOtpInput.value = '';
                loginOtpInput.focus();
            }
        }
    }

    async function finishPasswordLogin(userRow, role, clientIp) {
        const user = document.getElementById('username').value;
        const key = ipStorageKey(user, role);
        if (clientIp) localStorage.setItem(key, clientIp);
        currentUser = { ...userRow, accountType: role };
        initDashboard();
    }

    async function sendLoginSupabaseOtp() {
        const now = Date.now();
        if (now - lastLoginOtpSendAt < OTP_RESEND_COOLDOWN_MS && lastLoginOtpSendAt > 0) {
            const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - lastLoginOtpSendAt)) / 1000);
            throw new Error(`Please wait ${wait}s before requesting another code.`);
        }
        if (!pendingLoginAfterOtp || !pendingLoginAfterOtp.data.email) {
            throw new Error('Missing account email for verification.');
        }
        await supabase.auth.signOut().catch(() => {});
        const email = pendingLoginAfterOtp.data.email.trim();
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });
        if (error) throw new Error(error.message || 'Could not send verification email.');
        lastLoginOtpSendAt = Date.now();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const identifier = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value;
        const btn = e.target.querySelector('button[type="submit"]');
        const errBox = document.getElementById('login-error');

        btn.innerText = 'Verifying...';
        errBox.classList.add('hidden');

        try {
            // 1. Try to find in admins table first (Flexible search: email, username, or admin_name)
            let res = await supabase.from('admins')
                .select('*')
                .eq('password', pass)
                .or(`email.eq."${identifier}",username.eq."${identifier}",admin_name.eq."${identifier}"`)
                .maybeSingle();
            
            let role = 'admin';

            // 2. If not found, try employees table (Flexible search: email, username, or full_name)
            if (!res.data) {
                res = await supabase.from('employees')
                    .select('*')
                    .eq('password', pass)
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
                pendingLoginAfterOtp = { data: res.data, role };
                if (loginOtpEmailDisplay) loginOtpEmailDisplay.textContent = maskEmail(res.data.email);
                btn.innerText = 'Sending code...';
                try {
                    await sendLoginSupabaseOtp();
                    setLoginOtpPanelVisible(true);
                } catch (otpSendErr) {
                    pendingLoginAfterOtp = null;
                    errBox.innerText = otpSendErr.message || 'Could not send security code. Try again or use Cancel.';
                    errBox.classList.remove('hidden');
                }
                return;
            }

            if (ipChanged && !hasEmail) {
                await finishPasswordLogin(res.data, role, clientIp);
                return;
            }

            await finishPasswordLogin(res.data, role, clientIp);
        } catch (err) {
            errBox.innerText = err.message;
            errBox.classList.remove('hidden');
        } finally {
            btn.innerText = 'Log In';
        }
    });

    if (loginOtpVerifyBtn) {
        loginOtpVerifyBtn.addEventListener('click', async () => {
            if (!pendingLoginAfterOtp) return;
            loginOtpError.classList.add('hidden');
            const token = (loginOtpInput && loginOtpInput.value.trim().replace(/\s+/g, '')) || '';
            if (token.length < 6) {
                loginOtpError.innerText = 'Enter the 6-digit code from your email.';
                loginOtpError.classList.remove('hidden');
                return;
            }
            const email = pendingLoginAfterOtp.data.email.trim();
            loginOtpVerifyBtn.innerText = 'Verifying...';
            loginOtpVerifyBtn.disabled = true;
            try {
                const { error: vErr } = await supabase.auth.verifyOtp({
                    email,
                    token,
                    type: 'email',
                });
                if (vErr) throw new Error(vErr.message || 'Invalid or expired code.');

                await supabase.auth.signOut().catch(() => {});

                const user = document.getElementById('username').value;
                const role = pendingLoginAfterOtp.role;
                const clientIp = await fetchClientIp();
                const key = ipStorageKey(user, role);
                if (clientIp) localStorage.setItem(key, clientIp);

                const row = pendingLoginAfterOtp.data;
                pendingLoginAfterOtp = null;
                setLoginOtpPanelVisible(false);
                currentUser = { ...row, accountType: role };
                initDashboard();
            } catch (err) {
                loginOtpError.innerText = err.message;
                loginOtpError.classList.remove('hidden');
            } finally {
                loginOtpVerifyBtn.innerText = 'Verify code';
                loginOtpVerifyBtn.disabled = false;
            }
        });
    }

    if (loginOtpResendBtn) {
        loginOtpResendBtn.addEventListener('click', async () => {
            loginOtpError.classList.add('hidden');
            loginOtpResendBtn.disabled = true;
            try {
                await sendLoginSupabaseOtp();
                loginOtpError.innerText = 'A new code has been sent.';
                loginOtpError.classList.remove('hidden');
                loginOtpError.classList.add('login-otp-success-msg');
                setTimeout(() => {
                    loginOtpError.classList.add('hidden');
                    loginOtpError.classList.remove('login-otp-success-msg');
                }, 4000);
            } catch (e) {
                loginOtpError.innerText = e.message || 'Resend failed.';
                loginOtpError.classList.remove('hidden');
            } finally {
                loginOtpResendBtn.disabled = false;
            }
        });
    }

    if (loginOtpCancelBtn) {
        loginOtpCancelBtn.addEventListener('click', () => {
            pendingLoginAfterOtp = null;
            supabase.auth.signOut().catch(() => {});
            setLoginOtpPanelVisible(false);
        });
    }

    // ==================== LOGOUT FUNCTION ====================
    // Clears user session and returns to login page
    window.logout = function() {
        currentUser = null;              // Clear user data
        clearInterval(shiftInterval);    // Stop any active timers
        stopDynamicAttendanceQr();
        supabase.auth.signOut().catch(() => {});
        document.getElementById('app-page').classList.add('hidden');
        document.getElementById('login-page').classList.remove('hidden');
    }

    // ==================== DASHBOARD INITIALIZATION ====================
    // Called after successful login
    // Sets up the main dashboard based on user role (admin vs student)
    // Configures navigation, loads initial data, and starts services
    
    function initDashboard() {
        // Hide login page and show app page
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        
        const isAdm = currentUser.accountType === 'admin';
        
        // Update user display name
        document.getElementById('nav-user-name').innerText = isAdm ? currentUser.admin_name : currentUser.full_name;
        
        // Load and display profile picture
        // Falls back to default avatar if no custom image set
        const avatarSrc = currentUser.avatar_url && currentUser.avatar_url.trim() !== '' ? currentUser.avatar_url : 'https://i.pravatar.cc/150?img=11';
        document.getElementById('nav-avatar').src = avatarSrc;

        document.getElementById('admin-nav').style.display = isAdm ? 'flex' : 'none';
        document.getElementById('student-nav').style.display = isAdm ? 'none' : 'flex';
        
        // Show edit profile button only for admins
        if(isAdm) document.getElementById('admin-edit-self-btn').classList.remove('hidden');
        else document.getElementById('admin-edit-self-btn').classList.add('hidden');

        // Hide all sections first
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        
        // Update greeting with time of day (animated SplitText)
        updateGreetings();

        // Load role-specific data
        if (isAdm) {
            // ADMIN: Show dashboard home and load employee data
            document.getElementById('section-home').classList.remove('hidden');
            loadAdminData();
            startGlobalShiftTimer();  // Start real-time shift tracking
        } else {
            // STUDENT: Show student home and load own data
            document.getElementById('student-home').classList.remove('hidden');
            loadStudentData();
            startDynamicAttendanceQr();
        }
        
        // Initialize MagicBento effects on dashboard cards
        setTimeout(() => initMagicBento(), 200);
        
        setTimeout(() => bindCardSpotlights(), 300);
    }

    // ==================== DYNAMIC GREETING with SplitText Animation ====================
    // Replaces static greeting with animated character-by-character reveal
    // Uses GSAP for smooth staggered animation
    
    function updateGreetings() {
        const hour = new Date().getHours();
        let tod = "Morning";
        if (hour >= 12 && hour < 17) tod = "Afternoon";
        else if (hour >= 17) tod = "Evening";

        const isAdm = currentUser.accountType === 'admin';
        const name = isAdm ? currentUser.admin_name : currentUser.full_name;
        const emoji = isAdm ? '👋' : '🎓';
        const text = `Good ${tod}, ${name} ${emoji}`;
        
        const targetId = isAdm ? 'admin-greeting-text' : 'student-greeting-text';
        const el = document.getElementById(targetId);
        if (!el) return;
        
        el.innerHTML = '';
        const words = text.split(/\s+/);
        words.forEach((word) => {
            const span = document.createElement('span');
            span.className = 'greeting-word';
            span.textContent = word;
            el.appendChild(span);
        });
        
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(
                el.querySelectorAll('.greeting-word'),
                { opacity: 0, y: 18, filter: 'blur(10px)' },
                {
                    opacity: 1,
                    y: 0,
                    filter: 'blur(0px)',
                    duration: 0.72,
                    ease: 'power2.out',
                    stagger: 0.09,
                    delay: 0.12,
                }
            );
        }
    }

    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all nav buttons
            navBtns.forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
            
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            if(targetId === 'section-dashboards') renderCharts();
            if(targetId === 'section-shift') renderShifts();
            if(targetId === 'section-portfolio') renderPortfolio('All');
            if(targetId === 'section-calendar') simulateAdminHistory();
            
            if(targetId === 'student-id-view') loadStudentData();
            if(targetId === 'student-home') startDynamicAttendanceQr();
            if(targetId === 'student-calendar-view') generateStudentCalendar();
            if(targetId === 'student-directory-view') renderStudentDirectory();
        });
    });

    // ==================== PROFILE PICTURE UPLOAD ====================
    // Allows users to upload custom profile pictures
    // Converts image to Base64 and stores in Supabase
    // Updates display immediately for better UX
    
    document.getElementById('profile-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function(evt) {
                // Convert image to Base64 data URL
                const base64Img = evt.target.result;
                
                // Update avatar in header immediately
                document.getElementById('nav-avatar').src = base64Img;
                
                // If student, also update embedded virtual ID avatar
                if(currentUser.accountType === 'student') {
                    const vidAvatar = document.getElementById('embedded-vid-avatar');
                    if (vidAvatar) vidAvatar.src = base64Img;
                }

                // Save to database
                const table = currentUser.accountType === 'admin' ? 'admins' : 'employees';
                await supabase.from(table).update({ avatar_url: base64Img }).eq('id', currentUser.id);
                
                // Update currentUser object
                currentUser.avatar_url = base64Img;
                
                showToast("Profile picture updated!");
            }
            reader.readAsDataURL(file);
        }
    });

    // ==================== UTILITY: TOAST NOTIFICATIONS ====================
    // Shows temporary notification messages to user
    // Automatically hides after 3 seconds
    // Used for success messages, warnings, etc.
    //
    // USAGE: showToast("Your message here")
    
    let toastHideTimer = null;
    function showToast(msg, durationMs = 3200) {
        const t = document.getElementById('toast');
        const msgEl = document.getElementById('toast-msg');
        if (!t || !msgEl) return;
        if (toastHideTimer) clearTimeout(toastHideTimer);
        msgEl.innerText = msg;
        t.classList.remove('hidden');
        toastHideTimer = setTimeout(() => {
            t.classList.add('hidden');
            toastHideTimer = null;
        }, durationMs);
    }

    // ==================== UTILITY: ACTIVITY FEED LOGGING ====================
    // Adds entry to admin activity feed showing who did what and when
    // Entries show at top of feed (newest first)
    // Max 50 entries visible at once
    
    function addFeedLog(name, action) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        activityFeedLogs.unshift(`<div class="feed-item"><span class="feed-time">${timeStr}</span><b>${name}</b> ${action}</div>`);
        const feedEl = document.getElementById('admin-activity-feed');
        if (feedEl) feedEl.innerHTML = activityFeedLogs.join('');
    }

    // ================================ ADMIN-SPECIFIC FUNCTIONS ================================
    
    // ==================== ADMIN PROFILE EDITOR ====================
    // Allows admin to edit their own profile (name, username, email)
    // Modal-based edit form
    
    document.getElementById('admin-edit-self-btn').addEventListener('click', () => {
        // Populate form with current admin data
        document.getElementById('self-edit-name').value = currentUser.admin_name || '';
        document.getElementById('self-edit-user').value = currentUser.username || '';
        document.getElementById('self-edit-email').value = currentUser.email || '';
        // Show modal
        document.getElementById('admin-self-edit-modal').classList.remove('hidden');
    });

    document.getElementById('admin-save-self-btn').addEventListener('click', async () => {
        // Collect updated values
        const updates = {
            admin_name: document.getElementById('self-edit-name').value,
            username: document.getElementById('self-edit-user').value,
            email: document.getElementById('self-edit-email').value
        };
        
        // Update in Supabase
        const { error } = await supabase.from('admins').update(updates).eq('id', currentUser.id);
        
        if(!error) {
            // Update local user object
            currentUser = { ...currentUser, ...updates };
            // Update display
            document.getElementById('nav-user-name').innerText = currentUser.admin_name;
            updateGreetings();
            // Close modal and show success
            document.getElementById('admin-self-edit-modal').classList.add('hidden');
            showToast("Admin profile updated successfully.");
        } else {
            alert("Error updating profile: " + error.message);
        }
    });

    // ==================== LOAD ADMIN DATA ====================
    // Fetches all employees from Supabase database
    // Caches data in allEmployees array for quick access
    
    async function loadAdminData() {
        const { data } = await supabase.from('employees').select('*');
        allEmployees = data || [];
        renderAdminRoster();
    }

    // ==================== RENDER ADMIN ROSTER TABLE ====================
    // Displays all employees in table format
    // Shows: Name, ID, Department, Team, Status, Edit button
    // Also updates KPI cards (total, present, absent)
    
    function renderAdminRoster() {
        const tbody = document.getElementById('admin-roster-body');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        // Add row for each employee
        allEmployees.forEach(emp => {
            // Style status text based on current status
            const statusColor = emp.status === 'Present' ? 'text-success font-bold' : 'text-danger';
            tbody.innerHTML += `
                <tr>
                    <td><b>${emp.full_name}</b><br><small class="text-muted">${emp.emp_id}</small></td>
                    <td><b>${emp.department}</b><br><small class="text-muted">${emp.team || 'Unassigned'}</small></td>
                    <td class="${statusColor}">${emp.status || 'Absent'}</td>
                    <td><button class="btn-secondary text-xs p-2" onclick="openAdminEdit(${emp.id})">Edit</button></td>
                </tr>
            `;
        });
        
        // Update KPI cards
        const kpiTotal = document.getElementById('kpi-total');
        if(kpiTotal) kpiTotal.innerText = allEmployees.length;
        
        const kpiPresent = document.getElementById('kpi-present');
        if(kpiPresent) kpiPresent.innerText = allEmployees.filter(e => e.status === 'Present').length;
        
        const kpiAbsent = document.getElementById('kpi-absent');
        if(kpiAbsent) kpiAbsent.innerText = allEmployees.filter(e => e.status === 'Absent' || e.status === 'Leave').length;
    }

    // ==================== OPEN STUDENT EDITOR MODAL ====================
    // Called when admin clicks "Edit" button on roster
    // Populates modal with student data for editing
    
    window.openAdminEdit = function(id) {
        const emp = allEmployees.find(e => e.id === id);
        if(!emp) return;
        
        // Populate form fields
        document.getElementById('edit-modal-id').value = emp.id;
        document.getElementById('edit-modal-empid').value = emp.emp_id;
        document.getElementById('edit-modal-name').value = emp.full_name;
        document.getElementById('edit-modal-status').value = emp.status || 'Absent';
        document.getElementById('edit-modal-dept').value = emp.department || 'Student';
        document.getElementById('edit-modal-batch').value = emp.batch || 'Batch 1';
        document.getElementById('edit-modal-team').value = emp.team || '';
        
        // Show modal
        document.getElementById('admin-edit-modal').classList.remove('hidden');
    }

    // ==================== SAVE STUDENT EDITS ====================
    // Saves changes made in student editor modal to Supabase
    
    document.getElementById('admin-save-student-btn').addEventListener('click', async () => {
        const id = document.getElementById('edit-modal-id').value;
        const updates = { 
            emp_id: document.getElementById('edit-modal-empid').value, 
            full_name: document.getElementById('edit-modal-name').value, 
            status: document.getElementById('edit-modal-status').value,
            department: document.getElementById('edit-modal-dept').value,
            batch: document.getElementById('edit-modal-batch').value,
            team: document.getElementById('edit-modal-team').value
        };
        
        // Update in Supabase
        await supabase.from('employees').update(updates).eq('id', id);
        // Close modal and refresh display
        document.getElementById('admin-edit-modal').classList.add('hidden');
        loadAdminData(); 
        showToast("Student updated!");
    });

    // ==================== ADMIN QR CODE SCANNER ====================
    // Uses webcam to scan student QR codes for attendance marking
    // Requires HTTPS or localhost to access camera
    // Scanned data must match student emp_id to mark them present
    
    const qrBtn = document.getElementById('admin-open-qr-btn');
    if (qrBtn) {
        qrBtn.addEventListener('click', () => {
            // Show scanner modal
            document.getElementById('qr-modal').classList.remove('hidden');
            
            // Initialize Html5QRCode scanner
            html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
                fps: 10,                              // 10 frames per second
                qrbox: { width: 250, height: 250 }   // Scan area size
            }, false);
            
            // Render camera feed
            html5QrcodeScanner.render(async (decodedText) => {
                const parsed = parseScannedAttendancePayload(decodedText);
                if (parsed.error === 'expired') {
                    alert('This attendance QR has expired. Ask the student to wait for a fresh code on their dashboard.');
                    closeScanner();
                    return;
                }
                if (parsed.error === 'bad_format') {
                    alert('Could not read this QR code.');
                    closeScanner();
                    return;
                }
                const lookupId = parsed.empId;
                const emp = allEmployees.find(e => e.emp_id === lookupId);
                
                if(emp) {
                    await supabase.from('employees').update({ 
                        status: 'Present', 
                        shift_status: 'On-Shift' 
                    }).eq('id', emp.id);
                    
                    showToast(`✅ Verified: ${emp.full_name}`);
                    addFeedLog(emp.full_name, "checked in via Admin Scanner");
                    loadAdminData();
                } else {
                    alert(`Unknown QR (no employee for ID): ${lookupId}`);
                }
                closeScanner();
            }, (error) => {
                // Handle scanner error silently
            });
        });
    }

    // ==================== CLOSE QR SCANNER ====================
    function closeScanner() {
        if(html5QrcodeScanner) html5QrcodeScanner.clear();
        document.getElementById('qr-modal').classList.add('hidden');
    }
    
    const closeQrBtn = document.getElementById('close-qr-btn');
    if(closeQrBtn) closeQrBtn.addEventListener('click', closeScanner);

    // ==================== GLOBAL SHIFT TIMER ====================
    // Updates work duration every 1 second for employees on-shift
    // Accumulates shift_seconds in database
    // Timer runs continuously until logout
    
    function startGlobalShiftTimer() {
        // Clear any existing timer
        if(shiftInterval) clearInterval(shiftInterval);
        
        // Increment shift seconds every 1 second for on-shift employees
        shiftInterval = setInterval(() => {
            let updated = false;
            allEmployees.forEach(e => {
                // Only count time for present employees who are on-shift
                if(e.status === 'Present' && e.shift_status === 'On-Shift') { 
                    e.shift_seconds = (e.shift_seconds || 0) + 1; 
                    updated = true;
                }
            });
            // Update display if shift tab is visible
            if(updated && !document.getElementById('section-shift').classList.contains('hidden')) {
                renderShifts();
            }
        }, 1000);
    }

    // ==================== RENDER SHIFT TABLE ====================
    // Displays real-time work duration for present employees
    // Format: HH:MM:SS (hours:minutes:seconds)
    
    function renderShifts() {
        const tbody = document.getElementById('shift-tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        // Show only present employees
        allEmployees.filter(e => e.status === 'Present').forEach(emp => {
            // Convert seconds to HH:MM:SS format
            const h = Math.floor(emp.shift_seconds / 3600).toString().padStart(2, '0');
            const m = Math.floor((emp.shift_seconds % 3600) / 60).toString().padStart(2, '0');
            const s = (emp.shift_seconds % 60).toString().padStart(2, '0');
            
            tbody.innerHTML += `<tr><td><b>${emp.full_name}</b></td><td><span class="badge-role">${emp.shift_status}</span></td><td class="font-mono">${h}:${m}:${s}</td></tr>`;
        });
    }

    // ==================== ADMIN ATTENDANCE HISTORY ====================
    // Shows attendance records filtered by selected date
    // Data is simulated - in production would fetch from database history table
    
    function simulateAdminHistory() {
        const dateInputEl = document.getElementById('history-date');
        if(!dateInputEl) return;
        const dateInput = dateInputEl.value;
        const tbody = document.getElementById('history-tbody');
        
        tbody.innerHTML = '';
        
        // If no date selected, show prompt
        if(!dateInput) { 
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Select a date to view history.</td></tr>'; 
            return; 
        }
        
        // If no employees loaded, show message
        if(allEmployees.length === 0) { 
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No records found.</td></tr>'; 
            return; 
        }

        // Generate record for each employee on selected date
        allEmployees.forEach(emp => {
            // If date is today, show actual status. Otherwise simulate random status
            const isToday = (new Date().toISOString().split('T')[0] === dateInput);
            const status = isToday ? (emp.status || 'Absent') : (Math.random() > 0.3 ? 'Present' : (Math.random() > 0.5 ? 'Late' : 'Absent'));
            const statusColor = status === 'Present' ? 'text-success font-bold' : (status === 'Late' ? 'text-warning font-bold' : 'text-danger font-bold');
            
            tbody.innerHTML += `<tr><td><b>${emp.full_name}</b></td><td>${dateInput}</td><td class="${statusColor}">${status}</td></tr>`;
        });
    }
    
    // Update history when date changes
    const histDate = document.getElementById('history-date');
    if(histDate) histDate.addEventListener('change', simulateAdminHistory);
    
    // ==================== PORTFOLIO FILTER FUNCTION ====================
    // Filters employee portfolio by department
    // Called when department filter button is clicked
    
    window.filterPortfolio = function(dept) {
        // Update active button styling
        document.querySelectorAll('#section-portfolio .btn-outline').forEach(b => {
            b.classList.remove('active');
            if(b.innerText === dept) b.classList.add('active');
        });
        renderPortfolio(dept);
    }

    // ==================== RENDER EMPLOYEE PORTFOLIO ====================
    // Displays all employees as clickable cards in grid layout
    // Can filter by department: 'All', 'SOFTDEV', '3D DESIGN TEAM'
    // Clicking card shows employee's virtual ID
    
    function renderPortfolio(deptFilter = 'All') {
        const grid = document.getElementById('portfolio-grid');
        if(!grid) return;
        grid.innerHTML = '';
        
        // Filter employees by department if specified
        let filtered = deptFilter !== 'All' ? allEmployees.filter(e => e.department === deptFilter) : allEmployees;

        if(filtered.length === 0) { 
            grid.innerHTML = `<p class="text-muted col-span-full">No employees found.</p>`; 
            return; 
        }
        
        // Render card for each employee
        filtered.forEach(emp => {
            const safeAvatar = emp.avatar_url && emp.avatar_url.trim() !== '' ? emp.avatar_url : 'https://i.pravatar.cc/150?img=11';
            // Escape single quotes in bio to prevent string injection
            const safeBio = emp.bio ? emp.bio.replace(/'/g, "\\'") : '';
            const safePhone = emp.phone != null ? escJsQuoted(emp.phone) : '';
            const safeEmpId = escJsQuoted(emp.emp_id);
            const safeName = escJsQuoted(emp.full_name);
            const safeRole = escJsQuoted(emp.role);
            const safeDept = escJsQuoted(emp.department);
            const safeTeam = escJsQuoted(emp.team || 'Unassigned');
            const safeAvatarJs = escJsQuoted(safeAvatar);
            
            grid.innerHTML += `
                <div class="emp-card" onclick="showVID('${safeEmpId}', '${safeName}', '${safeRole}', '${safeDept}', '${safeAvatarJs}', '${safeTeam}', '${safeBio}', '${safePhone}')">
                    <img src="${safeAvatar}" style="width:60px; height:60px; border-radius:50%; object-fit:cover; margin-bottom:10px;">
                    <h4>${emp.full_name}</h4>
                    <p class="text-xs text-muted">${emp.department}</p>
                    <p class="text-xs font-bold mt-2" style="color:var(--primary-color);">${emp.team || 'Unassigned'}</p>
                </div>
            `;
        });
    }

    // ==================== RENDER ANALYTICS CHARTS ====================
    // Creates Chart.js instances for attendance and department distribution
    // Called when admin clicks Reports/Dashboard tab
    // Shows: Attendance pie chart, Department bar chart
    
    function getChartThemeColors() {
        const cs = getComputedStyle(document.documentElement);
        return {
            axis: (cs.getPropertyValue('--chart-axis').trim() || '#a1a1aa'),
            grid: (cs.getPropertyValue('--chart-grid').trim() || 'rgba(63,63,70,0.55)'),
        };
    }

    function renderCharts() {
        const { axis: chartAxisColor, grid: chartGridColor } = getChartThemeColors();
        const presentCount = allEmployees.filter(e => e.status === 'Present').length;
        const lateCount = allEmployees.filter(e => e.status === 'Late').length;
        const absentCount = Math.max(0, allEmployees.length - presentCount - lateCount);

        const attCtx = document.getElementById('attendanceChart');
        if (attCtx) {
            if (window.attChart) window.attChart.destroy();

            window.attChart = new Chart(attCtx.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Team attendance'],
                    datasets: [
                        { label: 'Present', data: [presentCount], backgroundColor: '#22c55e', stack: 'a' },
                        { label: 'Late', data: [lateCount], backgroundColor: '#ca8a04', stack: 'a' },
                        { label: 'Absent', data: [absentCount], backgroundColor: '#b91c1c', stack: 'a' },
                    ],
                },
                options: {
                    indexAxis: 'y',
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: chartAxisColor } },
                        title: { display: false },
                    },
                    scales: {
                        x: {
                            stacked: true,
                            ticks: { color: chartAxisColor, precision: 0 },
                            grid: { color: chartGridColor },
                        },
                        y: {
                            stacked: true,
                            ticks: { color: chartAxisColor },
                            grid: { display: false },
                        },
                    },
                },
            });
        }

        const deptCtx = document.getElementById('deptChart');
        if (deptCtx) {
            if (window.deptChart) window.deptChart.destroy();

            const inDept = (emp, key) => {
                if (key === 'soft') return emp.department === 'SOFTDEV';
                if (key === '3d') return emp.department === '3D DESIGN TEAM';
                return emp.department !== 'SOFTDEV' && emp.department !== '3D DESIGN TEAM';
            };
            const labels = ['SOFTDEV', '3D DESIGN', 'Unassigned'];
            const keys = ['soft', '3d', 'other'];
            const presentPer = keys.map((k) => allEmployees.filter((e) => inDept(e, k) && e.status === 'Present').length);
            const latePer = keys.map((k) => allEmployees.filter((e) => inDept(e, k) && e.status === 'Late').length);
            const absentPer = keys.map((k) => allEmployees.filter((e) => inDept(e, k) && e.status !== 'Present' && e.status !== 'Late').length);

            window.deptChart = new Chart(deptCtx.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Present', data: presentPer, backgroundColor: '#22c55e', stack: 'd' },
                        { label: 'Late', data: latePer, backgroundColor: '#ca8a04', stack: 'd' },
                        { label: 'Absent', data: absentPer, backgroundColor: '#b91c1c', stack: 'd' },
                    ],
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: chartAxisColor } },
                    },
                    scales: {
                        x: {
                            stacked: true,
                            ticks: { color: chartAxisColor },
                            grid: { color: chartGridColor },
                        },
                        y: {
                            stacked: true,
                            ticks: { color: chartAxisColor, precision: 0 },
                            grid: { color: chartGridColor },
                        },
                    },
                },
            });
        }
    }

    document.addEventListener('syncorg-themechange', () => {
        const sec = document.getElementById('section-dashboards');
        if (sec && !sec.classList.contains('hidden')) renderCharts();
    });

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const expBtn = document.getElementById('export-csv-btn');
    if (expBtn) {
        expBtn.addEventListener('click', async () => {
            showToast('Generating CSV…', 5000);
            await sleep(320);
            const rows = allEmployees.map((emp) => ({
                'Employee ID': emp.emp_id,
                'Full Name': emp.full_name,
                Department: emp.department,
                Batch: emp.batch || 'Batch 1',
                Team: emp.team || 'Unassigned',
                Status: emp.status || 'Absent',
            }));
            const csv = Papa.unparse(rows);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'attendance_report.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showToast('CSV ready — download started.');
        });
    }

    const expPdfBtn = document.getElementById('export-pdf-btn');
    if (expPdfBtn) {
        expPdfBtn.addEventListener('click', async () => {
            showToast('Generating PDF…', 8000);
            await sleep(400);
            const doc = new jsPDF({ unit: 'pt', format: 'a4' });
            const margin = 48;
            let y = margin;
            doc.setFontSize(14);
            doc.text('SYNC — Attendance export', margin, y);
            y += 28;
            doc.setFontSize(9);
            doc.setTextColor(120, 120, 120);
            doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
            y += 22;
            doc.setTextColor(0, 0, 0);
            allEmployees.forEach((emp) => {
                const line = `${emp.emp_id}  |  ${emp.full_name}  |  ${emp.department}  |  ${emp.status || 'Absent'}`;
                if (y > 760) {
                    doc.addPage();
                    y = margin;
                }
                doc.text(line, margin, y);
                y += 14;
            });
            doc.save('attendance_report.pdf');
            showToast('PDF ready — download started.');
        });
    }


    // ================================ STUDENT-SPECIFIC FUNCTIONS ================================
    
    // ==================== LOAD STUDENT DATA ====================
    // Fetches and displays student's own data in dashboard
    // Updates: Profile fields, virtual ID card, current status, schedule
    // Called on dashboard load and when data needs refreshing
    
    async function loadStudentData() {
        // Fetch fresh student data from Supabase (syncs admin changes immediately)
        const { data, error } = await supabase.from('employees').select('*').eq('id', currentUser.id).single();
        if (data && !error) currentUser = { ...currentUser, ...data }; 

        // === SAFE DOM UPDATES (Prevents "Cannot set properties of null" errors) ===
        // Each element is checked for existence before updating
        
        // 1. Dashboard Tab - Profile Settings
        const elUser = document.getElementById('std-edit-username');
        if(elUser) elUser.value = currentUser.username || '';
        
        const elBio = document.getElementById('std-edit-bio');
        if(elBio) elBio.value = currentUser.bio || '';
        
        const elShift = document.getElementById('std-shift-select');
        if(elShift) elShift.value = currentUser.shift_status || 'Off-Shift';
        
        // Update attendance status with color coding
        const stat = document.getElementById('std-current-status');
        if(stat) {
            stat.innerText = currentUser.status || 'Absent';
            stat.className = currentUser.status === 'Present' ? 'text-2xl font-bold text-success' : 'text-2xl font-bold text-danger';
        }

        // 2. Virtual ID Tab - ID Card Display
        const vidName = document.getElementById('embedded-vid-name');
        if(vidName) vidName.innerText = currentUser.full_name || 'Name';
        
        const vidRole = document.getElementById('embedded-vid-role');
        if(vidRole) vidRole.innerText = currentUser.role || 'Student Employee';
        
        const vidDept = document.getElementById('embedded-vid-dept');
        if(vidDept) vidDept.innerText = currentUser.department || 'Student';
        
        const vidEmpId = document.getElementById('embedded-vid-empid');
        if(vidEmpId) vidEmpId.innerText = currentUser.emp_id || 'EV-000';

        const vidPhone = document.getElementById('embedded-vid-phone');
        if(vidPhone) {
            const p = currentUser.phone;
            vidPhone.innerText = (p != null && String(p).trim() !== '') ? String(p).trim() : 'Not on file';
        }
        
        const vidTeam = document.getElementById('embedded-vid-team');
        if(vidTeam) vidTeam.innerText = currentUser.team || 'Unassigned';
        
        const avatarUrl = currentUser.avatar_url && currentUser.avatar_url.trim() !== '' ? currentUser.avatar_url : 'https://i.pravatar.cc/150?img=11';
        const vidAvatar = document.getElementById('embedded-vid-avatar');
        if(vidAvatar) vidAvatar.src = avatarUrl;
        
        const safeEmpId = currentUser.emp_id || 'EV-000';
        const vidQr = document.getElementById('embedded-vid-qr');
        setQrOnImage(vidQr, safeEmpId, 200);

        bindCardSpotlights();

        // Generate weekly schedule based on batch
        generateStudentSchedule(currentUser.batch || 'Batch 1');
    }

    // ==================== SAVE STUDENT PROFILE ====================
    // Saves username and bio changes to database
    // Also triggers virtual ID refresh
    
    const saveProfBtn = document.getElementById('std-save-profile-btn');
    if(saveProfBtn) {
        saveProfBtn.addEventListener('click', async () => {
            const nu = document.getElementById('std-edit-username').value;
            const nb = document.getElementById('std-edit-bio').value;
            
            // Update in Supabase
            await supabase.from('employees').update({ username: nu, bio: nb }).eq('id', currentUser.id);
            
            // Update local user object
            currentUser.username = nu; 
            currentUser.bio = nb;
            
            showToast("Profile & Bio saved.");
            // Refresh virtual ID card immediately
            loadStudentData();
        });
    }

    // ==================== MARK ATTENDANCE BUTTON ====================
    // Allows student to manually mark themselves as present
    // Sets status to "Present" and shift to "On-Shift"
    // Adds entry to admin activity feed
    
    const markBtn = document.getElementById('std-mark-btn');
    if(markBtn) {
        markBtn.addEventListener('click', async () => {
            try {
                // Update status in database
                const { error } = await supabase.from('employees').update({ 
                    status: 'Present', 
                    shift_status: 'On-Shift' 
                }).eq('id', currentUser.id);
                
                if(error) throw error;
                
                // Update local state
                currentUser.status = 'Present'; 
                currentUser.shift_status = 'On-Shift';
                
                // Refresh UI
                await loadStudentData();
                addFeedLog(currentUser.full_name, "marked attendance manually");
                showToast("Attendance Recorded.");
            } catch (err) {
                console.error(err);
                alert("Database Error: " + err.message);
            }
        });
    }

    // ==================== SHOW QR CODE BUTTON ====================
    // Displays student's virtual ID card with QR code in modal
    
    const showQrBtn = document.getElementById('std-show-qr-btn');
    if(showQrBtn) {
        showQrBtn.addEventListener('click', () => {
            showVID(currentUser.emp_id, currentUser.full_name, currentUser.role, currentUser.department, currentUser.avatar_url, currentUser.team, currentUser.bio, currentUser.phone);
        });
    }

    // ==================== SUBMIT ACTIVITY LOG ====================
    // Logs student's shift status and optional comments
    // Used to track when students go on/off shift or take breaks
    
    const submitLogBtn = document.getElementById('std-submit-log-btn');
    if(submitLogBtn) {
        submitLogBtn.addEventListener('click', async () => {
            const ns = document.getElementById('std-shift-select').value;
            
            // Update shift status in database
            await supabase.from('employees').update({ shift_status: ns }).eq('id', currentUser.id);
            
            // Update local state
            currentUser.shift_status = ns;
            
            // Log activity
            addFeedLog(currentUser.full_name, `updated shift to ${ns}`);
            
            // Show appropriate message
            if(ns === 'Off-Shift') showToast("Shift ended. Email Notification sent.");
            else showToast("Activity logged.");
            
            // Clear comment field
            const commentInput = document.getElementById('std-comment-input');
            if(commentInput) commentInput.value = '';
        });
    }

    function generateStudentSchedule(batch) {
        const grid = document.getElementById('student-schedule-grid');
        if(!grid) return;
        grid.innerHTML = '';
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        days.forEach((day, index) => {
            let isOnline = false;
            if (batch === 'Batch 1') isOnline = (index % 2 !== 0); 
            if (batch === 'Batch 2') isOnline = (index % 2 === 0); 
            const mode = isOnline ? 'Online' : 'Face to Face';
            const badgeClass = isOnline ? 'text-primary' : 'text-success';
            grid.innerHTML += `<div class="card p-4 text-center"><h4 class="mb-2">${day}</h4><p class="text-xs text-muted mb-2">08:00 AM - 06:00 PM</p><span class="font-bold ${badgeClass}">${mode}</span></div>`;
        });
    }

    async function renderStudentDirectory() {
        const grid = document.getElementById('student-directory-grid');
        if(!grid) return;
        grid.innerHTML = '<p class="text-muted">Loading directory...</p>';
        const { data } = await supabase.from('employees').select('id, full_name, role, department, team, bio, avatar_url').neq('id', currentUser.id);
        
        grid.innerHTML = '';
        if(!data || data.length === 0) { grid.innerHTML = '<p class="text-muted">No other students found.</p>'; return; }

        data.forEach(emp => {
            const bioSafe = emp.bio ? emp.bio.replace(/'/g, "\\'") : '';
            grid.innerHTML += `
                <div class="emp-card" onclick="showPublicProfile('${emp.full_name}', '${emp.role}', '${emp.department}', '${emp.avatar_url}', '${emp.team}', '${bioSafe}')">
                    <img src="${emp.avatar_url || 'https://i.pravatar.cc/150?img=11'}" style="width:60px; height:60px; border-radius:50%; object-fit:cover; margin-bottom:10px;">
                    <h4>${emp.full_name}</h4>
                    <p class="text-xs text-muted mb-2">${emp.department}</p>
                    <span class="badge bg-light text-primary border-color" style="border: 1px solid;">${emp.team || 'Unassigned'}</span>
                </div>
            `;
        });
    }

    window.showPublicProfile = function(name, role, dept, avatar, team, bio) {
        document.getElementById('pub-name').innerText = name;
        document.getElementById('pub-role').innerText = role || 'Student Employee';
        document.getElementById('pub-dept').innerText = dept || 'Student';
        document.getElementById('pub-team').innerText = team || 'Unassigned';
        document.getElementById('pub-bio').innerText = bio ? `"${bio}"` : '"No bio provided."';
        document.getElementById('pub-avatar').src = avatar || 'https://i.pravatar.cc/150?img=11';
        document.getElementById('public-profile-modal').classList.remove('hidden');
    }

    // SHARED VID MODAL LOGIC (Used by Admin clicking Portfolio AND Student clicking 'Show QR')
    window.showVID = function(id, name, role, dept, avatar, team, bio, phone) {
        document.getElementById('vid-name').innerText = name;
        document.getElementById('vid-role').innerText = role || 'Student Employee';
        document.getElementById('vid-dept').innerText = dept || 'Student';
        document.getElementById('vid-empid').innerText = id || 'EV-000';
        document.getElementById('vid-team').innerText = team || 'Unassigned';
        const phoneEl = document.getElementById('vid-phone');
        if (phoneEl) {
            phoneEl.innerText = (phone != null && String(phone).trim() !== '') ? String(phone).trim() : 'Not on file';
        }
        document.getElementById('vid-bio').innerText = bio ? `"${bio}"` : '"No bio provided."';
        
        const safeAvatar = avatar && avatar.trim() !== '' ? avatar : 'https://i.pravatar.cc/150?img=11';
        document.getElementById('vid-avatar').src = safeAvatar;
        
        const safeId = id || 'EV-000';
        setQrOnImage(document.getElementById('vid-qr'), safeId, 200);
        
        document.getElementById('vid-modal').classList.remove('hidden');
        bindCardSpotlights();
    }

    const calPrev = document.getElementById('cal-prev');
    if(calPrev) calPrev.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); generateStudentCalendar(); });
    
    const calNext = document.getElementById('cal-next');
    if(calNext) calNext.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); generateStudentCalendar(); });

    function generateStudentCalendar() {
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth();
        const grid = document.getElementById('student-calendar-grid');
        if(!grid) return;
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        document.getElementById('current-month-display').innerText = `${monthNames[month]} ${year}`;
        grid.innerHTML = '';
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

        for(let i = 0; i < firstDay; i++) grid.innerHTML += `<div class="cal-day empty"></div>`;
        for(let day = 1; day <= daysInMonth; day++) {
            const isToday = isCurrentMonth && day === today.getDate();
            let classes = 'cal-day bg-gray text-main';
            if (isToday) {
                classes += ' cal-day--today';
                if (currentUser.status === 'Present') classes += ' cal-day--status-present';
                else if (currentUser.status === 'Late') classes += ' cal-day--status-late';
            }
            grid.innerHTML += `<div class="${classes}">${day}</div>`;
        }
    }

    // ==================== ProfileCard QR Button ====================
    const pcShowQrBtn = document.getElementById('pc-show-qr-btn');
    if(pcShowQrBtn) {
        pcShowQrBtn.addEventListener('click', () => {
            if (currentUser) {
                showVID(currentUser.emp_id, currentUser.full_name, currentUser.role, currentUser.department, currentUser.avatar_url, currentUser.team, currentUser.bio, currentUser.phone);
            }
        });
    }

    // ================================ REACTBITS COMPONENT ENGINES ================================
    // Login Light Rays background: see lightrays-init.js (WebGL + ogl, matches React Bits LightRays).

    // ==================== MAGIC BENTO - Interactive Dashboard Cards ====================
    // Adds spotlight glow, particles, and border glow to dashboard cards
    
    const BENTO_GLOW_COLOR = '59, 130, 246';
    const BENTO_SPOTLIGHT_RADIUS = 400;
    const BENTO_PARTICLE_COUNT = 12;
    
    function initMagicBento() {
        // Find all dashboard cards and apply MagicBento classes
        const cards = document.querySelectorAll('.card, .kpi-card');
        cards.forEach(card => {
            if (!card.classList.contains('magic-bento-card')) {
                card.classList.add('magic-bento-card', 'magic-bento-card--border-glow');
                card.style.setProperty('--glow-color', BENTO_GLOW_COLOR);
            }
        });
        
        // Setup global spotlight
        setupBentoSpotlight();
        
        // Setup particle effects on hover
        setupBentoParticles();
    }
    
    function setupBentoSpotlight() {
        // Create global spotlight element
        let spotlight = document.querySelector('.global-spotlight');
        if (!spotlight) {
            spotlight = document.createElement('div');
            spotlight.className = 'global-spotlight';
            spotlight.style.background = `radial-gradient(circle, rgba(${BENTO_GLOW_COLOR}, 0.15) 0%, rgba(${BENTO_GLOW_COLOR}, 0.08) 15%, rgba(${BENTO_GLOW_COLOR}, 0.04) 25%, rgba(${BENTO_GLOW_COLOR}, 0.02) 40%, transparent 70%)`;
            document.body.appendChild(spotlight);
        }
        
        const proximity = BENTO_SPOTLIGHT_RADIUS * 0.5;
        const fadeDistance = BENTO_SPOTLIGHT_RADIUS * 0.75;
        
        document.addEventListener('mousemove', (e) => {
            const dashBody = document.querySelector('.dashboard-body');
            if (!dashBody) return;
            
            const rect = dashBody.getBoundingClientRect();
            const mouseInside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            
            const cards = document.querySelectorAll('.magic-bento-card');
            
            if (!mouseInside) {
                if (typeof gsap !== 'undefined') {
                    gsap.to(spotlight, { opacity: 0, duration: 0.3, ease: 'power2.out' });
                }
                cards.forEach(card => card.style.setProperty('--glow-intensity', '0'));
                return;
            }
            
            let minDistance = Infinity;
            cards.forEach(card => {
                const cardRect = card.getBoundingClientRect();
                const centerX = cardRect.left + cardRect.width / 2;
                const centerY = cardRect.top + cardRect.height / 2;
                const distance = Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2;
                const effectiveDistance = Math.max(0, distance);
                
                minDistance = Math.min(minDistance, effectiveDistance);
                
                let glowIntensity = 0;
                if (effectiveDistance <= proximity) {
                    glowIntensity = 1;
                } else if (effectiveDistance <= fadeDistance) {
                    glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity);
                }
                
                const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100;
                const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100;
                
                card.style.setProperty('--glow-x', `${relativeX}%`);
                card.style.setProperty('--glow-y', `${relativeY}%`);
                card.style.setProperty('--glow-intensity', glowIntensity.toString());
                card.style.setProperty('--glow-radius', `${BENTO_SPOTLIGHT_RADIUS}px`);
            });
            
            if (typeof gsap !== 'undefined') {
                gsap.to(spotlight, { left: e.clientX, top: e.clientY, duration: 0.1, ease: 'power2.out' });
                const targetOpacity = minDistance <= proximity ? 0.8 : (minDistance <= fadeDistance ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.8 : 0);
                gsap.to(spotlight, { opacity: targetOpacity, duration: 0.2, ease: 'power2.out' });
            }
        });
    }
    
    function setupBentoParticles() {
        document.querySelectorAll('.magic-bento-card').forEach(card => {
            if (card._bentoSetup) return;
            card._bentoSetup = true;
            
            let particles = [];
            let timeouts = [];
            
            card.addEventListener('mouseenter', () => {
                const rect = card.getBoundingClientRect();
                for (let i = 0; i < BENTO_PARTICLE_COUNT; i++) {
                    const tid = setTimeout(() => {
                        const particle = document.createElement('div');
                        particle.className = 'bento-particle';
                        particle.style.left = Math.random() * rect.width + 'px';
                        particle.style.top = Math.random() * rect.height + 'px';
                        particle.style.background = `rgba(${BENTO_GLOW_COLOR}, 1)`;
                        particle.style.boxShadow = `0 0 6px rgba(${BENTO_GLOW_COLOR}, 0.6)`;
                        card.appendChild(particle);
                        particles.push(particle);
                        
                        if (typeof gsap !== 'undefined') {
                            gsap.fromTo(particle, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
                            gsap.to(particle, { x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100, rotation: Math.random() * 360, duration: 2 + Math.random() * 2, ease: 'none', repeat: -1, yoyo: true });
                            gsap.to(particle, { opacity: 0.3, duration: 1.5, ease: 'power2.inOut', repeat: -1, yoyo: true });
                        }
                    }, i * 100);
                    timeouts.push(tid);
                }
            });
            
            card.addEventListener('mouseleave', () => {
                timeouts.forEach(clearTimeout);
                timeouts = [];
                particles.forEach(p => {
                    if (typeof gsap !== 'undefined') {
                        gsap.to(p, { scale: 0, opacity: 0, duration: 0.3, ease: 'back.in(1.7)', onComplete: () => p.remove() });
                    } else {
                        p.remove();
                    }
                });
                particles = [];
            });
            
            // Click ripple effect
            card.addEventListener('click', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const maxDistance = Math.max(
                    Math.hypot(x, y),
                    Math.hypot(x - rect.width, y),
                    Math.hypot(x, y - rect.height),
                    Math.hypot(x - rect.width, y - rect.height)
                );
                
                const ripple = document.createElement('div');
                ripple.style.cssText = `position: absolute; width: ${maxDistance * 2}px; height: ${maxDistance * 2}px; border-radius: 50%; background: radial-gradient(circle, rgba(${BENTO_GLOW_COLOR}, 0.4) 0%, rgba(${BENTO_GLOW_COLOR}, 0.2) 30%, transparent 70%); left: ${x - maxDistance}px; top: ${y - maxDistance}px; pointer-events: none; z-index: 1000;`;
                card.appendChild(ripple);
                
                if (typeof gsap !== 'undefined') {
                    gsap.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: () => ripple.remove() });
                } else {
                    setTimeout(() => ripple.remove(), 800);
                }
            });
        });
    }

});

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useTheme } from './context/ThemeContext.jsx';
import { ORG_SECRET, maskEmail } from './lib/supabase.js';
import ColorBends from './components/ColorBends/ColorBends.jsx';
import { Card, CardContent, CardHeader } from './components/ui/card.tsx';
import { Input } from './components/ui/input.tsx';
import { Label } from './components/ui/label.tsx';
import { Button } from './components/ui/button.tsx';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { ArrowLeft, ArrowRight, Check, Sun, Moon, Loader2, Eye, EyeOff } from 'lucide-react';

const BENDS_PROPS = {
  rotation: 45, speed: 0.7,
  colors: ['#000000', '#1D2545', '#ffffff'],
  transparent: true, autoRotate: 0, scale: 1, frequency: 1,
  warpStrength: 1, mouseInfluence: 1, parallax: 0.5, noise: 0.1,
};

const OTP_COOLDOWN = 45000;

export default function LoginPage() {
  const { login, sendLoginOtp, verifyLoginOtp, sendSignupOtp, completeSignup, assertIdentifiersFree, signInWithGoogle, pendingCheckin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signin'); // signin | signup
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Login OTP state
  const [loginOtp, setLoginOtp] = useState({ active: false, email: '', userData: null, role: '', clientIp: '', code: '' });

  // Signup stepper
  const [step, setStep] = useState(1);
  const [signupRole, setSignupRole] = useState('student');
  const [orgId, setOrgId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [lastOtpSend, setLastOtpSend] = useState(0);

  // Show checkin prompt
  useEffect(() => {
    if (pendingCheckin && !pendingCheckin.expired) {
      setSuccess('Log in to complete your attendance check-in.');
    } else if (pendingCheckin?.expired) {
      setError('This session QR has expired. Please ask the administrator for a fresh QR.');
    }
  }, [pendingCheckin]);

  // ─ Login submit ──────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const result = await login(identifier, password);
      if (result.needsOtp) {
        // Need OTP
        try {
          await sendLoginOtp(result.email);
          setLoginOtp({ active: true, email: result.email, userData: result.userData, role: result.role, clientIp: result.clientIp, code: '' });
        } catch (otpErr) {
          setError(otpErr.message);
        }
      }
      // success case handled by App.jsx redirect
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─ Login OTP verify ──────────────────────────────────────────────
  const handleVerifyLoginOtp = async () => {
    if (loginOtp.code.length < 6) { setError('Enter the 6-digit code.'); return; }
    setError(''); setLoading(true);
    try {
      await verifyLoginOtp(loginOtp.email, loginOtp.code.trim(), loginOtp.userData, loginOtp.role, identifier);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ─ Signup step validation ────────────────────────────────────────
  const validateSignupStep = () => {
    setError('');
    if (step === 1) {
      if (signupRole === 'admin') {
        if (!orgId.trim()) { setError('Enter your organization code.'); return false; }
        if (orgId.trim() !== ORG_SECRET) { setError('That organization code is not valid.'); return false; }
      } else {
        if (!studentId.trim()) { setError('Enter your Student ID.'); return false; }
      }
    }
    if (step === 2) {
      if (!regName.trim() || !regUsername.trim() || !regEmail.trim() || !regPassword.trim()) { setError('Fill in all fields.'); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) { setError('Please enter a valid email.'); return false; }
    }
    return true;
  };

  const handleSignupNext = async () => {
    if (!validateSignupStep()) return;
    setError(''); setLoading(true);
    try {
      if (step === 2) {
        await assertIdentifiersFree(regUsername.trim(), regEmail.trim(), studentId.trim(), signupRole === 'admin');
        await sendSignupOtp(regEmail.trim());
        setLastOtpSend(Date.now());
      }
      setStep(s => s + 1);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleCompleteSignup = async () => {
    if (otpCode.trim().length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setError(''); setLoading(true);
    try {
      await completeSignup({
        role: signupRole, name: regName.trim(), email: regEmail.trim(),
        username: regUsername.trim(), password: regPassword, orgId: orgId.trim(),
        empId: studentId.trim(), phone: regPhone.trim(), otpToken: otpCode.trim(),
      });
      setSuccess('Account created! You can now sign in.');
      setMode('signin');
      setStep(1);
      setOtpCode(''); setRegName(''); setRegUsername(''); setRegEmail(''); setRegPassword(''); setRegPhone('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleResendOtp = async () => {
    if (Date.now() - lastOtpSend < OTP_COOLDOWN) {
      const wait = Math.ceil((OTP_COOLDOWN - (Date.now() - lastOtpSend)) / 1000);
      setError(`Wait ${wait}s before resending.`);
      return;
    }
    setError(''); setLoading(true);
    try {
      await sendSignupOtp(regEmail.trim());
      setLastOtpSend(Date.now());
      setSuccess('New code sent.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const resetSignup = () => { setStep(1); setOtpCode(''); setError(''); };

  // ─ Step indicators ───────────────────────────────────────────────
  const StepIndicator = ({ current, total }) => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => {
        const s = i + 1;
        return (
          <React.Fragment key={s}>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              s < current ? 'bg-foreground text-background' :
              s === current ? 'bg-foreground text-background ring-4 ring-foreground/20' :
              'bg-muted text-muted-foreground border border-border'
            }`}>
              {s < current ? <Check size={14} /> : s}
            </div>
            {s < total && <div className={`h-0.5 w-8 rounded-full transition-all duration-500 ${s < current ? 'bg-foreground' : 'bg-border'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 font-[Inter,system-ui,sans-serif]">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-40">
        <ColorBends {...BENDS_PROPS} pointerMode="window" />
      </div>

      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
          <ArrowLeft size={18} />
          <span className="text-sm font-semibold">Back</span>
        </Link>
        <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* Card */}
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px]">
        <Card className="bg-card/60 backdrop-blur-2xl border border-border/50 shadow-2xl">
          <CardHeader className="text-center pb-2 pt-6">
            <img src={mode === 'signup' ? "/Logo/3.svg" : "/Logo/1.svg"} alt="SYNC" className="h-10 w-auto mx-auto mb-3" />
            <h1 className="text-xl font-bold tracking-tight text-foreground">SYNC.org</h1>
            <p className="text-xs text-muted-foreground mt-1">Attendance & portfolio portal</p>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {/* Error / Success banners */}
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  {error}
                </motion.div>
              )}
              {success && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium">
                  {success}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Login OTP overlay */}
            {loginOtp.active ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h2 className="text-base font-bold text-foreground text-center">Security Verification</h2>
                <p className="text-xs text-muted-foreground text-center">
                  A code was sent to <strong className="text-foreground">{maskEmail(loginOtp.email)}</strong>
                </p>
                <div className="space-y-2">
                  <Label htmlFor="login-otp">6-digit code</Label>
                  <Input id="login-otp" value={loginOtp.code} onChange={(e) => setLoginOtp(p => ({ ...p, code: e.target.value }))}
                    placeholder="000000" maxLength={6} className="text-center text-lg tracking-[0.3em] font-mono" />
                </div>
                <Button onClick={handleVerifyLoginOtp} disabled={loading} className="w-full">
                  {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                  Verify code
                </Button>
                <Button variant="outline" onClick={() => { setLoginOtp({ active: false, email: '', userData: null, role: '', clientIp: '', code: '' }); setError(''); }} className="w-full">
                  Cancel
                </Button>
              </motion.div>
            ) : (
              <>
                {/* Tabs */}
                <Tabs value={mode} onValueChange={(v) => { setMode(v); setError(''); setSuccess(''); resetSignup(); }} className="mb-5">
                  <TabsList className="grid w-full grid-cols-2 h-10">
                    <TabsTrigger value="signin" className="text-sm font-semibold">Sign in</TabsTrigger>
                    <TabsTrigger value="signup" className="text-sm font-semibold">Sign up</TabsTrigger>
                  </TabsList>
                </Tabs>

                <AnimatePresence mode="wait">
                  {mode === 'signin' ? (
                    <motion.form key="signin" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.25 }} onSubmit={handleLogin} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Identifier</Label>
                        <Input id="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="Email, username, or ID" autoComplete="username" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                          <Input id="password" type={showPass ? 'text' : 'password'} value={password}
                            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
                          <button type="button" onClick={() => setShowPass(p => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                      <Button type="submit" disabled={loading} className="w-full">
                        {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                        Sign in
                      </Button>
                      <div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                        <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                      </div>
                      <Button type="button" variant="outline" onClick={signInWithGoogle} className="w-full gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        Continue with Google
                      </Button>
                    </motion.form>
                  ) : (
                    <motion.div key="signup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25 }}>
                      <StepIndicator current={step} total={3} />

                      <AnimatePresence mode="wait">
                        {step === 1 && (
                          <motion.div key="s1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                            <p className="text-sm font-semibold text-foreground text-center mb-2">Choose your role</p>
                            <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
                              {['student', 'admin'].map(r => (
                                <button key={r} type="button" onClick={() => setSignupRole(r)}
                                  className={`py-2.5 rounded-md text-sm font-semibold transition-all ${signupRole === r ? 'bg-foreground text-background shadow' : 'text-muted-foreground hover:text-foreground'}`}>
                                  {r === 'student' ? 'Student' : 'Admin'}
                                </button>
                              ))}
                            </div>
                            {signupRole === 'admin' ? (
                              <div className="space-y-2">
                                <Label>Organization Code</Label>
                                <Input value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="Enter org code" />
                                <p className="text-[11px] text-muted-foreground">Your administrator provides this passphrase.</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <Label>Student / Employee ID</Label>
                                <Input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="e.g. EV-001" />
                              </div>
                            )}
                          </motion.div>
                        )}
                        {step === 2 && (
                          <motion.div key="s2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                            <p className="text-sm font-semibold text-foreground text-center mb-1">Your details</p>
                            <div className="space-y-1.5"><Label>Full Name</Label><Input value={regName} onChange={e => setRegName(e.target.value)} placeholder="Juan Dela Cruz" /></div>
                            <div className="space-y-1.5"><Label>Username</Label><Input value={regUsername} onChange={e => setRegUsername(e.target.value)} placeholder="juandc" /></div>
                            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="you@email.com" /></div>
                            <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="••••••••" /></div>
                            <div className="space-y-1.5"><Label>Phone <span className="text-muted-foreground">(optional)</span></Label><Input value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="+63..." /></div>
                          </motion.div>
                        )}
                        {step === 3 && (
                          <motion.div key="s3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                            <p className="text-sm text-muted-foreground text-center">
                              A verification code was sent to <strong className="text-foreground">{regEmail}</strong>
                            </p>
                            <div className="space-y-2">
                              <Label>6-digit code</Label>
                              <Input value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="000000"
                                maxLength={6} className="text-center text-lg tracking-[0.3em] font-mono" />
                            </div>
                            <Button onClick={handleCompleteSignup} disabled={loading} className="w-full">
                              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                              Create account
                            </Button>
                            <button type="button" onClick={handleResendOtp} disabled={loading}
                              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 border border-border rounded-lg transition-colors">
                              Resend code
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Navigation */}
                      {step < 3 && (
                        <div className={`flex mt-5 ${step > 1 ? 'justify-between' : 'justify-end'}`}>
                          {step > 1 && (
                            <Button variant="outline" size="sm" onClick={() => { setStep(s => s - 1); setError(''); }}>
                              <ArrowLeft size={14} className="mr-1" /> Back
                            </Button>
                          )}
                          <Button size="sm" onClick={handleSignupNext} disabled={loading}>
                            {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                            Next <ArrowRight size={14} className="ml-1" />
                          </Button>
                        </div>
                      )}

                      {step < 3 && (
                        <>
                          <div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                            <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                          </div>
                          <Button type="button" variant="outline" onClick={signInWithGoogle} className="w-full gap-2">
                            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                            Continue with Google
                          </Button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

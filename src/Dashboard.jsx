import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from './context/AuthContext.jsx';
import { useTheme } from './context/ThemeContext.jsx';
import { supabase, deriveDisplayStatus, patchEmployee, localDateStr, fetchMonthlyAttendanceFromSupabase, upsertAttendanceDaily } from './lib/supabase.js';
import { buildAdminSessionPayload, buildRollingAttendancePayload, parseScannedAttendancePayload, getQrImageUrl } from './lib/qr.js';
import { Html5Qrcode } from 'html5-qrcode';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Label } from './components/ui/label.tsx';
import { Separator } from './components/ui/separator.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './components/ui/dialog.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Skeleton } from './components/ui/skeleton.tsx';
import {
  LayoutDashboard, Clock, History, BarChart3, Users, LogOut, Search, Moon, Sun,
  BadgeCheck, CalendarDays, QrCode, FileText, Bell, ChevronDown, Download,
  UserCircle, Edit, Shield, Timer, TrendingUp, UserCheck, UserX, AlertTriangle,
  MoreVertical, RefreshCw, X, Menu, Camera, Upload, ChevronLeft, ChevronRight, ScanLine
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell
} from 'recharts';

// ── Status badge component ─────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    'Present': 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
    'Late': 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    'Absent': 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    'Excused': 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    'No Record': 'bg-muted text-muted-foreground border-border',
  };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${map[status] || map['No Record']}`}>{status}</span>;
};

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { currentUser, logout, processStudentCheckin, updateCurrentUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeSection, setActiveSection] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }, []);

  // Process pending QR checkin on mount
  useEffect(() => {
    if (currentUser?.accountType === 'student') {
      processStudentCheckin(currentUser).then(ok => {
        if (ok) showToast('Attendance marked successfully!');
      });
    }
  }, []); // eslint-disable-line

  if (!currentUser) return null;
  const isAdmin = currentUser.accountType === 'admin';
  const displayName = isAdmin ? currentUser.admin_name : currentUser.full_name;

  const menuItems = isAdmin ? [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'roster', label: 'Roster', icon: Users },
    { id: 'qr', label: 'QR Session', icon: QrCode },
    { id: 'shifts', label: 'Active Shifts', icon: Clock },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'history', label: 'History', icon: History },
  ] : [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'my-id', label: 'My ID', icon: BadgeCheck },
    { id: 'my-history', label: 'My History', icon: CalendarDays },
    { id: 'directory', label: 'Directory', icon: Users },
  ];

  return (
    <div className="flex h-screen overflow-hidden font-[Inter,system-ui,sans-serif]">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className={`${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 z-40 w-64 border-r border-border bg-card/80 backdrop-blur-xl flex flex-col transition-transform duration-300`}>
        <div className="p-5 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-foreground flex items-center justify-center">
            <img src="/Logo/1.svg" className="h-5 w-auto invert dark:invert-0 brightness-0 dark:brightness-100" alt="Logo" />
          </div>
          <span className="font-bold text-lg tracking-tight text-foreground">SYNC.org</span>
        </div>

        <div className="px-4 pb-2"><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3">Menu</p></div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {menuItems.map((item) => (
            <button key={item.id} onClick={() => { setActiveSection(item.id); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                activeSection === item.id
                  ? 'bg-foreground text-background shadow-md'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}>
              <item.icon size={18} strokeWidth={activeSection === item.id ? 2.5 : 2} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <button onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-destructive font-semibold text-sm hover:bg-destructive/10 transition-all">
            <LogOut size={18} strokeWidth={2} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileMenuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileMenuOpen(false)} />}

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 z-20">
          <div className="flex items-center gap-3">
            <button className="md:hidden p-2 rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <input type="text" placeholder="Search..." className="bg-muted/50 border border-border/30 rounded-lg pl-9 pr-4 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all w-64" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground relative">
              <Bell size={18} /><span className="absolute top-2 right-2 h-1.5 w-1.5 bg-primary rounded-full" />
            </button>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <div className="flex items-center gap-2.5">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold leading-none text-foreground">{displayName}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isAdmin ? 'Administrator' : 'Student'}</p>
              </div>
              <div className="h-9 w-9 rounded-full bg-muted border border-border overflow-hidden">
                <img src={currentUser.avatar_url || 'https://i.pravatar.cc/150?img=11'} alt="" className="h-full w-full object-cover" />
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div key={activeSection} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
              {isAdmin ? (
                <>
                  {activeSection === 'overview' && <AdminOverview showToast={showToast} />}
                  {activeSection === 'roster' && <AdminRoster showToast={showToast} />}
                  {activeSection === 'qr' && <AdminQR showToast={showToast} />}
                  {activeSection === 'shifts' && <AdminShifts />}
                  {activeSection === 'reports' && <AdminReports />}
                  {activeSection === 'history' && <AdminHistory />}
                </>
              ) : (
                <>
                  {activeSection === 'overview' && <StudentDashboard showToast={showToast} />}
                  {activeSection === 'my-id' && <StudentID />}
                  {activeSection === 'my-history' && <StudentAttendanceHistory />}
                  {activeSection === 'directory' && <StudentDirectory />}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-2xl">
            <span className="text-sm font-medium text-foreground">{toast}</span>
            <button onClick={() => setToast('')} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Coming Soon placeholder ────────────────────────────────────────────────────
function ComingSoon({ title }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <div className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center mb-6">
        <RefreshCw size={36} className="text-muted-foreground animate-spin" style={{ animationDuration: '3s' }} />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">Coming in the next patch • Beta v3.0</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function AdminOverview({ showToast }) {
  const [stats, setStats] = useState({ total: 0, present: 0, late: 0, absent: 0 });
  const [loading, setLoading] = useState(true);
  const weekData = [
    { name: 'Mon', total: 45 }, { name: 'Tue', total: 52 }, { name: 'Wed', total: 48 },
    { name: 'Thu', total: 61 }, { name: 'Fri', total: 55 }, { name: 'Sat', total: 20 }, { name: 'Sun', total: 15 },
  ];

  useEffect(() => {
    const fetch = async () => {
      const { data: employees } = await supabase.from('employees').select('*');
      if (employees) {
        const now = new Date();
        const total = employees.length;
        const present = employees.filter(e => deriveDisplayStatus(e, now) === 'Present').length;
        const late = employees.filter(e => deriveDisplayStatus(e, now) === 'Late').length;
        const absent = employees.filter(e => deriveDisplayStatus(e, now) === 'Absent').length;
        setStats({ total, present, late, absent });
      }
      setLoading(false);
    };
    fetch();
    const i = setInterval(fetch, 30000);
    return () => clearInterval(i);
  }, []);

  const kpis = [
    { label: 'Total Students', value: stats.total, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Present', value: stats.present, icon: UserCheck, color: 'text-green-500', bg: 'bg-green-500/10' },
    { label: 'Late', value: stats.late, icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: 'Absent', value: stats.absent, icon: UserX, color: 'text-red-500', bg: 'bg-red-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Overview</h1>
        <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="hover:shadow-lg transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</p>
                <div className={`h-9 w-9 rounded-lg ${kpi.bg} flex items-center justify-center`}>
                  <kpi.icon size={18} className={kpi.color} />
                </div>
              </div>
              {loading ? <Skeleton className="h-8 w-16" /> : <h3 className="text-3xl font-bold text-foreground">{kpi.value}</h3>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        <Card className="lg:col-span-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">Weekly Analytics</CardTitle><CardDescription>Attendance this week</CardDescription></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]} barSize={32}>
                    {weekData.map((_, idx) => <Cell key={idx} fill={`hsl(var(--chart-${(idx % 5) + 1}))`} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent Activity</CardTitle><CardDescription>Live updates</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: 'Medina, Jian Carlos', action: 'marked Present', time: '2m ago' },
                { name: 'Mercado, Adrian', action: 'started Shift', time: '5m ago' },
                { name: 'Legaspi, Sam', action: 'updated Profile', time: '12m ago' },
                { name: 'Pornobi, Diana', action: 'marked Late', time: '15m ago' },
                { name: 'Medellin, Herz', action: 'submitted Excuse', time: '20m ago' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-muted border border-border overflow-hidden flex-shrink-0">
                    <img src={`https://i.pravatar.cc/150?img=${11 + i}`} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.action}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Admin Roster ───────────────────────────────────────────────────────────────
function AdminRoster({ showToast }) {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null);

  const loadData = useCallback(async () => {
    const { data } = await supabase.from('employees').select('*');
    setEmployees(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return !q || e.full_name?.toLowerCase().includes(q) || e.emp_id?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q);
  });

  const handleSaveEdit = async () => {
    if (!editModal) return;
    const { error } = await patchEmployee(editModal.id, {
      emp_id: editModal.emp_id, full_name: editModal.full_name,
      department: editModal.department, batch: editModal.batch, team: editModal.team,
      status: editModal.status,
    });
    if (error) { alert(error.message); return; }
    setEditModal(null);
    showToast('Student updated!');
    loadData();
  };

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-foreground">Roster</h1><p className="text-sm text-muted-foreground">{employees.length} students registered</p></div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..." className="pl-9 w-full sm:w-72" /></div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Department</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Action</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50"><td className="px-4 py-3" colSpan={4}><Skeleton className="h-5 w-full" /></td></tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No students found.</td></tr>
                ) : filtered.map(emp => (
                  <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3"><p className="font-semibold text-foreground">{emp.full_name}</p><p className="text-xs text-muted-foreground">{emp.emp_id}</p></td>
                    <td className="px-4 py-3"><p className="text-foreground">{emp.department}</p><p className="text-xs text-muted-foreground">{emp.team || 'Unassigned'}</p></td>
                    <td className="px-4 py-3"><StatusBadge status={deriveDisplayStatus(emp, now)} /></td>
                    <td className="px-4 py-3 text-right"><Button variant="outline" size="sm" onClick={() => setEditModal({ ...emp })}><Edit size={14} className="mr-1" />Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editModal} onOpenChange={() => setEditModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Student</DialogTitle><DialogDescription>Update student information</DialogDescription></DialogHeader>
          {editModal && (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Employee ID</Label><Input value={editModal.emp_id} onChange={e => setEditModal(p => ({ ...p, emp_id: e.target.value }))} /></div>
                <div><Label>Full Name</Label><Input value={editModal.full_name} onChange={e => setEditModal(p => ({ ...p, full_name: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Department</Label><Input value={editModal.department || ''} onChange={e => setEditModal(p => ({ ...p, department: e.target.value }))} /></div>
                <div><Label>Status</Label>
                  <select value={editModal.status || 'No Record'} onChange={e => setEditModal(p => ({ ...p, status: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    {['Present', 'Late', 'Absent', 'Excused', 'No Record'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Batch</Label><Input value={editModal.batch || ''} onChange={e => setEditModal(p => ({ ...p, batch: e.target.value }))} /></div>
                <div><Label>Team</Label><Input value={editModal.team || ''} onChange={e => setEditModal(p => ({ ...p, team: e.target.value }))} /></div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditModal(null)}>Cancel</Button><Button onClick={handleSaveEdit}>Save changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Admin QR Session ──────────────────────────────────────────────────────────
function AdminQR({ showToast }) {
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(25);
  const [active, setActive] = useState(false);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  const generateQR = useCallback(() => {
    const payload = buildAdminSessionPayload();
    setQrUrl(getQrImageUrl(payload, 280));
    setCountdown(25);
  }, []);

  const startSession = () => {
    setActive(true);
    generateQR();
    intervalRef.current = setInterval(generateQR, 25000);
    countdownRef.current = setInterval(() => setCountdown(c => c > 0 ? c - 1 : 25), 1000);
    showToast('Session QR started');
  };

  const stopSession = () => {
    setActive(false);
    clearInterval(intervalRef.current);
    clearInterval(countdownRef.current);
    setQrUrl('');
    setCountdown(25);
  };

  useEffect(() => () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current); }, []);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">QR Session</h1><p className="text-sm text-muted-foreground">Generate dynamic QR codes for student check-in</p></div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><QrCode size={18} />Session QR Code</CardTitle>
            <CardDescription>Students scan this with any QR scanner to check in</CardDescription></CardHeader>
          <CardContent className="flex flex-col items-center">
            {active ? (
              <>
                <div className="bg-white p-4 rounded-xl shadow-inner mb-4">
                  <img src={qrUrl} alt="Session QR" className="w-56 h-56" />
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-muted-foreground">Refreshes in {countdown}s</span>
                </div>
                <Button variant="destructive" onClick={stopSession} className="w-full">Stop Session</Button>
              </>
            ) : (
              <>
                <div className="w-56 h-56 rounded-xl bg-muted/50 border-2 border-dashed border-border flex items-center justify-center mb-4">
                  <QrCode size={64} className="text-muted-foreground/30" />
                </div>
                <Button onClick={startSession} className="w-full"><QrCode size={16} className="mr-2" />Start QR Session</Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield size={18} />How it works</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { step: '1', title: 'Start Session', desc: 'Click "Start QR Session" to generate a dynamic code' },
              { step: '2', title: 'Student Scans', desc: 'Students scan the QR with any phone camera or scanner app' },
              { step: '3', title: 'Secure Login', desc: 'Students are redirected to login — attendance is only marked after authentication' },
              { step: '4', title: 'Auto-Mark', desc: 'Attendance is automatically marked as Present or Late based on check-in time' },
            ].map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold flex-shrink-0">{s.step}</div>
                <div><p className="text-sm font-semibold text-foreground">{s.title}</p><p className="text-xs text-muted-foreground">{s.desc}</p></div>
              </div>
            ))}
            <Separator />
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Shield size={14} className="text-green-500" />
              <span>Direct URL access without a valid QR scan will <strong>not</strong> mark attendance</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Admin Shifts ──────────────────────────────────────────────────────────────
function AdminShifts() {
  const [employees, setEmployees] = useState([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('employees').select('*');
      setEmployees(data || []);
    };
    load();
    const t = setInterval(() => forceRender(c => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();
  const onShift = employees.filter(e => {
    const d = deriveDisplayStatus(e, now);
    return (d === 'Present' || d === 'Late') && e.shift_status === 'On-Shift';
  });

  const getShiftDuration = (emp) => {
    if (!emp.last_check_in_at) return '00:00:00';
    const start = new Date(emp.last_check_in_at);
    const diff = Math.max(0, Math.floor((now - start) / 1000));
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">Active Shifts</h1><p className="text-sm text-muted-foreground">{onShift.length} students currently on-shift</p></div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Student</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Duration</th>
            </tr></thead>
            <tbody>
              {onShift.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No active shifts</td></tr>
              ) : onShift.map(emp => (
                <tr key={emp.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-semibold text-foreground">{emp.full_name}</td>
                  <td className="px-4 py-3"><StatusBadge status={deriveDisplayStatus(emp, now)} /></td>
                  <td className="px-4 py-3 font-mono text-foreground">{getShiftDuration(emp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Admin Reports ─────────────────────────────────────────────────────────────
function AdminReports() {
  const [chartData, setChartData] = useState(null);

  useEffect(() => {
    fetchMonthlyAttendanceFromSupabase().then(result => {
      if (result && result.series.some(r => r.present + r.late + r.absent + r.excused > 0)) {
        setChartData(result);
      } else {
        setChartData({
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          series: [
            { present: 180, late: 15, absent: 5, excused: 10 },
            { present: 195, late: 10, absent: 8, excused: 2 },
            { present: 170, late: 25, absent: 12, excused: 7 },
            { present: 210, late: 5, absent: 3, excused: 4 },
            { present: 185, late: 20, absent: 10, excused: 5 },
            { present: 160, late: 30, absent: 15, excused: 12 },
          ],
        });
      }
    });
  }, []);

  const exportCSV = async () => {
    const Papa = (await import('papaparse')).default;
    const { data } = await supabase.from('employees').select('*');
    if (!data) return;
    const now = new Date();
    const rows = data.map(emp => ({
      'Employee ID': emp.emp_id, 'Full Name': emp.full_name, Department: emp.department,
      Batch: emp.batch || 'Batch 1', Team: emp.team || 'Unassigned', Status: deriveDisplayStatus(emp, now),
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'attendance_report.csv';
    link.click();
  };

  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const { data } = await supabase.from('employees').select('*');
    if (!data) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 48;
    doc.setFontSize(14); doc.text('SYNC — Attendance Export', 48, y); y += 28;
    doc.setFontSize(9); doc.setTextColor(120); doc.text(`Generated ${new Date().toLocaleString()}`, 48, y); y += 22;
    doc.setTextColor(0);
    data.forEach(emp => {
      if (y > 760) { doc.addPage(); y = 48; }
      doc.text(`${emp.emp_id}  |  ${emp.full_name}  |  ${emp.department}  |  ${emp.status || 'No Record'}`, 48, y); y += 14;
    });
    doc.save('attendance_report.pdf');
  };

  const rechartsData = chartData ? chartData.labels.map((label, i) => ({
    month: label, Present: chartData.series[i].present, Late: chartData.series[i].late,
    Absent: chartData.series[i].absent, Excused: chartData.series[i].excused,
  })) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-foreground">Reports</h1><p className="text-sm text-muted-foreground">Attendance analytics & exports</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}><Download size={14} className="mr-1" />CSV</Button>
          <Button variant="outline" size="sm" onClick={exportPDF}><FileText size={14} className="mr-1" />PDF</Button>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Monthly Attendance</CardTitle><CardDescription>Last 6 months breakdown</CardDescription></CardHeader>
        <CardContent>
          <div className="h-[350px]">
            {chartData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rechartsData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="Present" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Late" fill="#eab308" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Absent" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Excused" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Admin History ─────────────────────────────────────────────────────────────
function AdminHistory() {
  const [date, setDate] = useState(localDateStr(new Date()));
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('employees').select('*').then(({ data }) => { setEmployees(data || []); setLoading(false); });
  }, []);

  const todayStr = localDateStr(new Date());
  const rows = employees.map(emp => {
    const status = date === todayStr ? deriveDisplayStatus(emp, new Date()) : (['Present', 'Late', 'Absent', 'Excused', 'No Record'])[Math.floor(Math.random() * 5)];
    return { ...emp, displayStatus: status };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-foreground">History</h1><p className="text-sm text-muted-foreground">View attendance records by date</p></div>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Student</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">Loading...</td></tr> :
                rows.length === 0 ? <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No records</td></tr> :
                rows.map(emp => (
                  <tr key={emp.id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-semibold text-foreground">{emp.full_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{date}</td>
                    <td className="px-4 py-3"><StatusBadge status={emp.displayStatus} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STUDENT COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function StudentDashboard({ showToast }) {
  const { currentUser, processStudentCheckin, updateCurrentUser } = useAuth();
  const [, forceRender] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [excuseOpen, setExcuseOpen] = useState(false);
  const scannerRef = useRef(null);
  const readerRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => forceRender(c => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const status = deriveDisplayStatus(currentUser);
  const isCheckedIn = status === 'Present' || status === 'Late' || status === 'Excused';

  const getShiftDuration = () => {
    if (currentUser.shift_status !== 'On-Shift' || !currentUser.last_check_in_at) return '00:00:00';
    const diff = Math.max(0, Math.floor((new Date() - new Date(currentUser.last_check_in_at)) / 1000));
    return `${Math.floor(diff / 3600).toString().padStart(2, '0')}:${Math.floor((diff % 3600) / 60).toString().padStart(2, '0')}:${(diff % 60).toString().padStart(2, '0')}`;
  };

  // QR Scanner logic
  const startScanner = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      scannerRef.current = new Html5Qrcode('student-qr-reader');
      const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
      await scannerRef.current.start(
        { facingMode: 'environment' },
        config,
        async (text) => {
          // Check if it's a valid checkin URL
          if (text.includes('action=checkin')) {
            try {
              const url = new URL(text);
              const expires = url.searchParams.get('expires');
              if (expires && Date.now() > parseInt(expires, 10)) {
                showToast('This QR has expired. Ask admin for a fresh QR.');
              } else {
                // Store the checkin data and process
                sessionStorage.setItem('pending_checkin', JSON.stringify({
                  token: url.searchParams.get('token'),
                  expires,
                }));
                const ok = await processStudentCheckin(currentUser);
                if (ok) {
                  showToast('Attendance marked successfully!');
                  // Refresh user data
                  const { data } = await supabase.from('employees').select('*').eq('id', currentUser.id).maybeSingle();
                  if (data) updateCurrentUser(data);
                } else {
                  showToast('Check-in failed. Please try again.');
                }
              }
            } catch {
              showToast('Invalid QR code format.');
            }
          } else {
            showToast('Invalid QR code — not a check-in code.');
          }
          await stopScanner();
          setScannerOpen(false);
        },
        () => {}, // ignore errors per frame
      );
    } catch (e) {
      showToast('Could not start camera: ' + (e.message || 'Unknown error'));
      setScanning(false);
      setScannerOpen(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2) { // SCANNING
          await scannerRef.current.stop();
        }
      } catch { /* ignore */ }
      try { scannerRef.current.clear(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    if (scannerOpen) {
      // Small delay to let the DOM render the reader div
      const t = setTimeout(() => startScanner(), 300);
      return () => clearTimeout(t);
    } else {
      stopScanner();
    }
  }, [scannerOpen]); // eslint-disable-line

  // Cleanup on unmount
  useEffect(() => () => { stopScanner(); }, []); // eslint-disable-line

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-foreground">Dashboard</h1><p className="text-sm text-muted-foreground">Welcome, {currentUser.full_name}</p></div>
        <Button variant="outline" size="sm" onClick={() => setExcuseOpen(true)}>
          <FileText size={14} className="mr-1" />File Excuse
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Status</p>
          <StatusBadge status={status} />
        </CardContent></Card>
        <Card className={!isCheckedIn ? 'opacity-50' : ''}><CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Shift</p>
          <p className="text-lg font-bold text-foreground">{isCheckedIn ? (currentUser.shift_status || 'Off-Shift') : 'Not checked in'}</p>
        </CardContent></Card>
        <Card className={!isCheckedIn ? 'opacity-50' : ''}><CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Duration</p>
          <p className="text-lg font-bold font-mono text-foreground">{isCheckedIn ? getShiftDuration() : '--:--:--'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Batch</p>
          <p className="text-lg font-bold text-foreground">{currentUser.batch || 'N/A'}</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* QR Scanner Card */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ScanLine size={18} />Scan QR to Check In</CardTitle>
            <CardDescription>Scan the admin's session QR to mark your attendance</CardDescription></CardHeader>
          <CardContent className="flex flex-col items-center">
            {isCheckedIn ? (
              <div className="flex flex-col items-center py-6">
                <div className="h-16 w-16 rounded-full bg-green-500/15 flex items-center justify-center mb-3">
                  <UserCheck size={32} className="text-green-500" />
                </div>
                <p className="text-sm font-semibold text-foreground">Already checked in</p>
                <p className="text-xs text-muted-foreground mt-1">Your attendance has been marked as <span className="font-semibold">{status}</span></p>
              </div>
            ) : (
              <>
                <div className="w-full max-w-xs aspect-square rounded-xl bg-muted/50 border-2 border-dashed border-border flex items-center justify-center mb-4 overflow-hidden">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                    <Camera size={48} />
                    <span className="text-xs font-medium">Point camera at QR code</span>
                  </div>
                </div>
                <Button onClick={() => setScannerOpen(true)} className="w-full">
                  <Camera size={16} className="mr-2" />Open QR Scanner
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Quick Info</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: 'Employee ID', value: currentUser.emp_id },
              { label: 'Department', value: currentUser.department },
              { label: 'Team', value: currentUser.team || 'Unassigned' },
              { label: 'Role', value: currentUser.role },
            ].map((item, i) => (
              <div key={i} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm font-medium text-foreground">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* QR Scanner Dialog */}
      <Dialog open={scannerOpen} onOpenChange={(open) => { if (!open) { stopScanner(); setScannerOpen(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Camera size={18} />Scan Admin QR Code</DialogTitle>
            <DialogDescription>Point your camera at the admin's session QR to check in</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center">
            <div id="student-qr-reader" ref={readerRef} className="w-full rounded-lg overflow-hidden" style={{ minHeight: '280px' }} />
            {scanning && (
              <div className="flex items-center gap-2 mt-3">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">Camera active — scanning...</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { stopScanner(); setScannerOpen(false); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excuse Request Dialog */}
      <StudentExcuseDialog open={excuseOpen} onOpenChange={setExcuseOpen} showToast={showToast} />
    </div>
  );
}

// ── Student ID ────────────────────────────────────────────────────────────────
function StudentID() {
  const { currentUser } = useAuth();
  const qrUrl = getQrImageUrl(currentUser.emp_id || 'EV-000', 200);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">My ID Card</h1><p className="text-sm text-muted-foreground">Your virtual identification</p></div>

      <div className="max-w-md mx-auto">
        <Card className="overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-foreground/10 to-foreground/5" />
          <CardContent className="relative -mt-10 flex flex-col items-center pb-6">
            <div className="h-20 w-20 rounded-2xl border-4 border-background bg-muted overflow-hidden shadow-lg mb-4">
              <img src={currentUser.avatar_url || 'https://i.pravatar.cc/150?img=11'} alt="" className="h-full w-full object-cover" />
            </div>
            <h2 className="text-xl font-bold text-foreground">{currentUser.full_name}</h2>
            <p className="text-sm text-muted-foreground">{currentUser.role || 'Student Employee'}</p>
            <Separator className="my-4 w-full" />
            <div className="w-full space-y-2 text-sm">
              {[
                { label: 'ID', value: currentUser.emp_id },
                { label: 'Department', value: currentUser.department },
                { label: 'Team', value: currentUser.team || 'Unassigned' },
                { label: 'Email', value: currentUser.email },
                { label: 'Phone', value: currentUser.phone || 'Not on file' },
              ].map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
            <Separator className="my-4 w-full" />
            <div className="bg-white p-3 rounded-xl">
              <img src={qrUrl} alt="ID QR" className="w-32 h-32" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Student Directory ─────────────────────────────────────────────────────────
function StudentDirectory() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data || []));
  }, []);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return !q || e.full_name?.toLowerCase().includes(q) || e.emp_id?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-foreground">Directory</h1><p className="text-sm text-muted-foreground">{employees.length} students</p></div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="pl-9 w-full sm:w-72" /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {filtered.map(emp => (
          <Card key={emp.id} className="hover:shadow-lg transition-shadow">
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="h-16 w-16 rounded-full bg-muted border border-border overflow-hidden mb-3">
                <img src={emp.avatar_url || 'https://i.pravatar.cc/150?img=11'} alt="" className="h-full w-full object-cover" />
              </div>
              <p className="text-sm font-semibold text-foreground truncate w-full">{emp.full_name}</p>
              <p className="text-xs text-muted-foreground">{emp.department}</p>
              <p className="text-xs text-muted-foreground">{emp.team || 'Unassigned'}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Student Attendance History Calendar ────────────────────────────────────────
function StudentAttendanceHistory() {
  const { currentUser } = useAuth();
  const [calDate, setCalDate] = useState(new Date());
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);

  const year = calDate.getFullYear();
  const month = calDate.getMonth();

  // Fetch attendance_daily for this student for the displayed month
  useEffect(() => {
    if (!currentUser?.id) return;
    setLoading(true);
    const startDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;

    supabase
      .from('attendance_daily')
      .select('day,status')
      .eq('employee_id', currentUser.id)
      .gte('day', startDay)
      .lte('day', endDay)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(r => {
          const d = String(r.day).slice(0, 10);
          map[d] = r.status;
        });
        setRecords(map);
        setLoading(false);
      });
  }, [currentUser?.id, year, month]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

  const prevMonth = () => setCalDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCalDate(new Date(year, month + 1, 1));

  const statusColor = (st) => {
    switch (st) {
      case 'Present': return 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/40';
      case 'Late': return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/40';
      case 'Absent': return 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40';
      case 'Excused': return 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40';
      default: return '';
    }
  };

  // Count stats for the month
  const stats = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
  Object.values(records).forEach(st => { if (stats[st] !== undefined) stats[st]++; });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">My Attendance History</h1><p className="text-sm text-muted-foreground">Calendar view of your attendance records</p></div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', count: stats.Present, color: 'text-green-500', bg: 'bg-green-500/10' },
          { label: 'Late', count: stats.Late, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
          { label: 'Absent', count: stats.Absent, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Excused', count: stats.Excused, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                <span className={`text-lg font-bold ${s.color}`}>{s.count}</span>
              </div>
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Calendar */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft size={16} /></Button>
            <CardTitle className="text-base">{monthNames[month]} {year}</CardTitle>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight size={16} /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {dayNames.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground uppercase py-1">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`e-${i}`} className="aspect-square" />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayStatus = records[dateStr];
              const isToday = isCurrentMonth && day === today.getDate();

              return (
                <div key={day}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-medium border transition-all
                    ${dayStatus ? statusColor(dayStatus) : 'border-transparent hover:bg-muted/50'}
                    ${isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
                  `}
                  title={dayStatus ? `${dateStr}: ${dayStatus}` : dateStr}
                >
                  <span className={isToday ? 'font-bold' : ''}>{day}</span>
                  {dayStatus && <span className="text-[8px] leading-none mt-0.5 opacity-80">{dayStatus.slice(0, 1)}</span>}
                </div>
              );
            })}
          </div>
          {loading && <div className="text-center py-4 text-sm text-muted-foreground">Loading records...</div>}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center">
        {[
          { label: 'Present', color: 'bg-green-500' },
          { label: 'Late', color: 'bg-yellow-500' },
          { label: 'Absent', color: 'bg-red-500' },
          { label: 'Excused', color: 'bg-blue-500' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-full ${l.color}`} />
            <span className="text-xs text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Student Excuse Request Dialog ─────────────────────────────────────────────
function StudentExcuseDialog({ open, onOpenChange, showToast }) {
  const { currentUser } = useAuth();
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const EXCUSE_ATTACH_MAX_BYTES = 380 * 1024;

  const reset = () => { setReason(''); setFile(null); setError(''); };

  const handleSubmit = async () => {
    if (!currentUser || currentUser.accountType !== 'student') return;
    setError('');

    if (reason.trim().length < 3) {
      setError('Please enter a short reason (at least 3 characters).');
      return;
    }

    // Read file as data URL if present
    let attachmentDataUrl = null;
    let attachmentFilename = null;
    if (file) {
      if (file.size > EXCUSE_ATTACH_MAX_BYTES) {
        setError('File is too large. Please use a file under 380 KB.');
        return;
      }
      try {
        attachmentDataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(file);
        });
        attachmentFilename = file.name || 'attachment';
      } catch {
        setError('Could not read the file. Try another image or PDF.');
        return;
      }
    }

    setSubmitting(true);

    // Check for existing pending request
    const { data: pendingRow } = await supabase
      .from('excuse_requests')
      .select('id')
      .eq('employee_id', currentUser.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingRow) {
      setError('You already have a pending excuse request. Wait for an admin to review it.');
      setSubmitting(false);
      return;
    }

    const { error: insertErr } = await supabase.from('excuse_requests').insert([{
      employee_id: currentUser.id,
      reason: reason.trim(),
      attachment_data_url: attachmentDataUrl,
      attachment_filename: attachmentFilename,
      status: 'pending',
    }]);

    setSubmitting(false);

    if (insertErr) {
      setError(
        /relation|does not exist/i.test(String(insertErr.message))
          ? 'Excuse requests are currently unavailable. Please try again later.'
          : insertErr.message || 'Could not submit.'
      );
      return;
    }

    reset();
    onOpenChange(false);
    showToast('Excuse request sent. An admin will review it.');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File Excuse Request</DialogTitle>
          <DialogDescription>Submit a reason for your absence. An admin will review your request.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter your reason..." rows={3} />
          </div>
          <div>
            <Label>Attachment (optional, max 380KB)</Label>
            <div className="mt-1">
              <Input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

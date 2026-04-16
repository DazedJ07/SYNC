import React, { useEffect, useState, useRef } from 'react';
import { motion, useAnimation, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import { useNavigate } from 'react-router-dom';
import { useTheme } from './context/ThemeContext.jsx';
import { Sun, Moon, ArrowRight, ChevronDown, Activity, Shield, Fingerprint, RefreshCw, Users, Zap } from 'lucide-react';
import ColorBends from './components/ColorBends/ColorBends.jsx';

const BENDS_PROPS = {
  rotation: 45, speed: 0.7,
  colors: ['#000000', '#1D2545', '#ffffff'],
  transparent: true, autoRotate: 0, scale: 1, frequency: 1,
  warpStrength: 1, mouseInfluence: 1, parallax: 0.5, noise: 0.1,
};

const Section = ({ children, id, className }) => {
  const controls = useAnimation();
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.08 });
  useEffect(() => { if (inView) controls.start('visible'); }, [controls, inView]);
  return (
    <motion.section id={id} ref={ref} initial="hidden" animate={controls}
      variants={{
        visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1], staggerChildren: 0.15 } },
        hidden: { opacity: 0, y: 50 },
      }}
      className={className}
    >{children}</motion.section>
  );
};

const FeatureIcon = ({ icon: Icon }) => (
  <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-500">
    <Icon size={28} className="text-primary" strokeWidth={1.5} />
  </div>
);

const LandingPage = () => {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  const goToLogin = () => navigate('/login');

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const features = [
    { icon: Activity, title: 'Real-Time Monitoring', desc: "Live bird's-eye view of attendance data. No lag, just instant updates across the board." },
    { icon: Shield, title: 'Data Integrity', desc: 'Enterprise-grade encryption with Supabase architecture. Private and tamper-proof by design.' },
    { icon: Fingerprint, title: 'Frictionless UI', desc: 'Clean, modern React interface. Every action is just a single click away from results.' },
    { icon: RefreshCw, title: 'Automated Syncing', desc: 'Harmonize data across your workspace automatically. Accurate data, always in real-time.' },
    { icon: Users, title: 'Role Management', desc: 'Granular control over permissions. Manage admin and student access levels with ease.' },
    { icon: Zap, title: 'High Performance', desc: 'Built for speed and reliability in large-scale modern attendance operations.' },
  ];

  const devs = [
    { name: 'Medina, Jian Carlos', role: 'Senior Developer', img: 'Medina.png' },
    { name: 'Mercado, Adrian', role: 'Developer', img: 'Mercado.png' },
    { name: 'Medellin, Herz Emmanuel', role: 'Developer', img: 'Medellin.png' },
    { name: 'Pornobi, Diana Althea', role: 'Developer', img: 'Pornobi.png' },
    { name: 'Legaspi, Sam', role: 'Developer', img: 'Legaspi.png' },
  ];

  return (
    <div className="relative min-h-screen font-[Inter,system-ui,sans-serif] selection:bg-primary/30 overflow-x-hidden">
      {/* Background Layer */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-30">
        <ColorBends {...BENDS_PROPS} pointerMode="window" />
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-2xl border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2.5">
            <img src={theme === 'dark' ? "/Logo/2.svg" : "/Logo/1.svg"} alt="SYNC Logo" className="h-8 w-auto" />
            <span className="text-xl font-extrabold tracking-tight text-foreground">SYNC.org</span>
          </motion.div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-5">
              {[{ label: 'Features', id: 'features' }, { label: 'About', id: 'about' }, { label: 'Devs', id: 'devs' }].map((item) => (
                <button key={item.id} onClick={() => scrollTo(item.id)}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pl-5 border-l border-border/40">
              {/* Theme toggle */}
              <button onClick={toggleTheme} aria-label="Toggle theme"
                className="relative h-8 w-14 rounded-full bg-muted border border-border/50 flex items-center px-1 transition-colors hover:border-primary/40">
                <motion.div className="h-6 w-6 rounded-full bg-foreground shadow-sm flex items-center justify-center"
                  animate={{ x: theme === 'dark' ? 22 : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                  {theme === 'dark' ? <Moon size={12} className="text-background" /> : <Sun size={12} className="text-background" />}
                </motion.div>
              </button>

              {/* Sign In */}
              <button onClick={goToLogin}
                className="px-5 py-2 text-sm font-semibold rounded-full bg-foreground text-background hover:opacity-90 active:scale-95 transition-all shadow-lg">
                Sign in
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative z-10 flex flex-col items-center justify-center min-h-[100svh] px-6 text-center max-w-5xl mx-auto">
        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="flex flex-col items-center">
          <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 text-xs font-semibold rounded-full bg-muted/80 backdrop-blur-md border border-border/60 text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] tracking-wider uppercase font-bold">Beta v3.0</span>
            Available now!
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="text-5xl sm:text-6xl md:text-8xl font-black tracking-tighter mb-6 leading-[0.95] text-foreground">
            Sync your <br className="hidden md:block" /> future today
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.8 }}
            className="max-w-2xl text-base md:text-lg text-muted-foreground font-medium leading-relaxed mb-10 px-4">
            The Modern Standard for Attendance Management. Bridging the gap between traditional record-keeping and the modern digital workspace.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.8 }}
            className="flex flex-col sm:flex-row gap-4">
            <button onClick={goToLogin}
              className="group px-8 py-3.5 text-base font-bold rounded-xl bg-foreground text-background hover:scale-[1.03] active:scale-95 transition-all shadow-2xl flex items-center gap-2">
              Get started
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button onClick={() => scrollTo('features')}
              className="px-8 py-3.5 text-base font-bold rounded-xl border border-border bg-background/50 backdrop-blur-sm text-foreground hover:bg-muted transition-all flex items-center gap-2">
              Explore features
              <ChevronDown size={18} />
            </button>
          </motion.div>
        </motion.div>


      </section>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <Section id="features" className="relative z-10 py-28 px-6 mx-auto max-w-7xl">
        <div className="text-center mb-16">
          <motion.h2 variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            className="text-3xl md:text-5xl font-black tracking-tight mb-4 text-foreground">Core Features</motion.h2>
          <div className="h-1 w-16 bg-foreground mx-auto rounded-full opacity-20" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div key={i}
              variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0 } }}
              className="group p-8 rounded-2xl bg-card/40 backdrop-blur-xl border border-border/30 hover:border-primary/30 transition-all duration-500 hover:shadow-xl hover:shadow-primary/5">
              <FeatureIcon icon={f.icon} />
              <h3 className="text-xl font-bold mt-5 mb-2 text-foreground tracking-tight">{f.title}</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ── About ──────────────────────────────────────────────────────── */}
      <Section id="about" className="relative z-10 py-28 px-6 mx-auto max-w-7xl">
        <div className="text-center mb-16">
          <motion.h2 variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            className="text-3xl md:text-5xl font-black tracking-tight mb-4 text-foreground">About SYNC</motion.h2>
          <div className="h-1 w-16 bg-foreground mx-auto rounded-full opacity-20" />
        </div>
        <div className="relative p-10 md:p-16 rounded-3xl bg-card/30 backdrop-blur-2xl border border-border/30 max-w-4xl mx-auto overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full" />
          <div className="relative z-10 flex flex-col gap-8 text-center md:text-left">
            <p className="text-xl md:text-2xl text-foreground font-bold leading-tight tracking-tight">
              "We bridge the gap between traditional record-keeping and the modern digital workspace."
            </p>
            <div className="grid md:grid-cols-2 gap-8">
              <p className="text-base text-muted-foreground leading-relaxed">
                SYNC is a streamlined attendance management system designed to replace outdated, fragmented processes with a single, unified source of truth for organizations.
              </p>
              <p className="text-base text-muted-foreground leading-relaxed">
                Our mission is to help organizations "sync" their daily operations with their long-term goals. Reliability, security, and simplicity are at our core.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Devs ───────────────────────────────────────────────────────── */}
      <Section id="devs" className="relative z-10 py-28 px-6 mx-auto max-w-7xl">
        <div className="text-center mb-16">
          <motion.h2 variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            className="text-3xl md:text-5xl font-black tracking-tight mb-4 text-foreground">The Devs</motion.h2>
          <div className="h-1 w-16 bg-foreground mx-auto rounded-full opacity-20" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8">
          {devs.map((dev, i) => (
            <motion.div key={i} whileHover={{ y: -8 }}
              variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
              className="flex flex-col items-center text-center group cursor-default">
              <div className="relative mb-5">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative h-28 w-28 rounded-2xl overflow-hidden border-2 border-border/50 group-hover:border-primary transition-all duration-500 shadow-lg">
                  <img src={`/The Devs/${dev.img}`} alt={dev.name} className="h-full w-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                </div>
              </div>
              <h3 className="font-bold text-sm mb-0.5 text-foreground tracking-tight">{dev.name}</h3>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">{dev.role}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="relative z-10 py-16 px-6 border-t border-border/40 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2.5">
            <img src="/Logo/1.svg" alt="SYNC Logo" className="h-7 w-auto" />
            <span className="text-lg font-bold tracking-tight text-foreground">SYNC.org</span>
          </div>
          <div className="flex gap-6 text-sm font-medium text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-foreground transition-colors">Contact Us</a>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 SYNC.org. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

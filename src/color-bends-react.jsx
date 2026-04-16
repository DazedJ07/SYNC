/**
 * Mounts React Bits ColorBends on the login/sign-up page only.
 * Dashboard uses a solid background; unmounts when the host is hidden to save WebGL contexts.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ColorBends from './components/ColorBends/ColorBends.jsx';
import LandingPage from './LandingPage.jsx';
import Dashboard from './Dashboard.jsx';

/** Matches React Bits Background Studio (monochrome) + your exported props */
const BENDS_PROPS = {
    rotation: 45,
    speed: 0.7,
    colors: ['#000000', '#1D2545', '#ffffff'],
    transparent: true,
    autoRotate: 0,
    scale: 1,
    frequency: 1,
    warpStrength: 1,
    mouseInfluence: 1,
    parallax: 0.5,
    noise: 0.1,
};

function useHostVisible(hostId) {
    const [visible, setVisible] = useState(() => {
        const el = document.getElementById(hostId);
        return !!(el && !el.classList.contains('hidden'));
    });

    useEffect(() => {
        const el = document.getElementById(hostId);
        if (!el) return undefined;

        const sync = () => setVisible(!el.classList.contains('hidden'));
        const obs = new MutationObserver(sync);
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
        sync();
        return () => obs.disconnect();
    }, [hostId]);

    return visible;
}

function LoginColorBends() {
    const visible = useHostVisible('login-page');
    if (!visible) return null;
    return <ColorBends {...BENDS_PROPS} pointerMode="window" />;
}

function AppColorBends() {
    return null;
}

const landingEl = document.getElementById('landing-page-root');
if (landingEl) {
    createRoot(landingEl).render(<LandingPage />);
}

const dashboardEl = document.getElementById('dashboard-root');
if (dashboardEl) {
    createRoot(dashboardEl).render(<Dashboard />);
}

const loginEl = document.getElementById('color-bends-root');
if (loginEl) {
    createRoot(loginEl).render(<LoginColorBends />);
}

const appEl = document.getElementById('app-color-bends-root');
if (appEl) {
    createRoot(appEl).render(<AppColorBends />);
}

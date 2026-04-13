/**
 * Vanilla BorderGlow: pointer-driven edge highlight (React Bits port).
 */

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function parseHSL(hslStr) {
    const match = String(hslStr).match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
    if (!match) return { h: 220, s: 12, l: 72 };
    return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
}

function buildGlowVars(glowColor, intensity) {
    const { h, s, l } = parseHSL(glowColor);
    const base = `${h}deg ${s}% ${l}%`;
    const opacities = [100, 60, 50, 40, 30, 20, 10];
    const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
    const vars = {};
    for (let i = 0; i < opacities.length; i++) {
        vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`;
    }
    return vars;
}

function buildGradientVars(colors) {
    const vars = {};
    for (let i = 0; i < 7; i++) {
        const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
        vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
    }
    vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
    return vars;
}

function getCenterOfElement(el) {
    const { width, height } = el.getBoundingClientRect();
    return [width / 2, height / 2];
}

function getEdgeProximity(el, x, y) {
    const [cx, cy] = getCenterOfElement(el);
    const dx = x - cx;
    const dy = y - cy;
    let kx = Infinity;
    let ky = Infinity;
    if (dx !== 0) kx = cx / Math.abs(dx);
    if (dy !== 0) ky = cy / Math.abs(dy);
    return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
}

function getCursorAngle(el, x, y) {
    const [cx, cy] = getCenterOfElement(el);
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return 0;
    const radians = Math.atan2(dy, dx);
    let degrees = radians * (180 / Math.PI) + 90;
    if (degrees < 0) degrees += 360;
    return degrees;
}

function applyBorderGlowVars(card, options) {
    const {
        glowColor = '220 12 72',
        glowIntensity = 0.85,
        colors = ['#94a3b8', '#cbd5e1', '#64748b'],
        fillOpacity = 0.35,
        edgeSensitivity = 28,
        glowRadius = 36,
        coneSpread = 25,
        borderRadius = 14,
    } = options || {};

    const glowVars = buildGlowVars(glowColor, glowIntensity);
    Object.assign(card.style, {
        '--edge-sensitivity': String(edgeSensitivity),
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': String(coneSpread),
        '--fill-opacity': String(fillOpacity),
        ...Object.fromEntries(Object.entries({ ...glowVars, ...buildGradientVars(colors) }).map(([k, v]) => [k, String(v)])),
    });
}

function attachBorderGlowPointer(card) {
    if (card._borderGlowPointer) return;
    card._borderGlowPointer = true;
    card.addEventListener('pointermove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const edge = getEdgeProximity(card, x, y);
        const angle = getCursorAngle(card, x, y);
        card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
        card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
    });
    card.addEventListener('pointerleave', () => {
        card.style.setProperty('--edge-proximity', '0');
    });
}

/**
 * Wraps .card / .kpi-card content for border glow layers.
 */
export function initBorderGlowCards(root = document) {
    const cards = root.querySelectorAll('.card.magic-bento-card, .kpi-card.magic-bento-card');
    cards.forEach((card) => {
        if (card.dataset.borderGlowReady === '1') return;
        card.dataset.borderGlowReady = '1';

        const isKpi = card.classList.contains('kpi-card');
        const solid = getComputedStyle(document.documentElement).getPropertyValue('--card-solid').trim() || '#18181b';

        const edge = document.createElement('span');
        edge.className = 'edge-light';
        edge.setAttribute('aria-hidden', 'true');

        const inner = document.createElement('div');
        inner.className = 'border-glow-inner';
        if (isKpi) inner.style.textAlign = 'center';

        while (card.firstChild) inner.appendChild(card.firstChild);
        card.appendChild(edge);
        card.appendChild(inner);

        card.classList.add('border-glow-card');
        card.style.setProperty('--card-bg', solid);

        applyBorderGlowVars(card, {
            glowColor: '220 14 68',
            colors: ['#64748b', '#94a3b8', '#e2e8f0'],
            borderRadius: 14,
        });
        attachBorderGlowPointer(card);
    });
}

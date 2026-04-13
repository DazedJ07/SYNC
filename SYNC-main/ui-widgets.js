/**
 * Vanilla OTP slot group (shadcn InputOTP-style) + date picker popover.
 */

function otpCollect(slots) {
    return Array.from(slots).map((el) => (el.value || '').replace(/\D/g, '').slice(-1)).join('');
}

function otpSyncHidden(slots, hidden) {
    if (hidden) hidden.value = otpCollect(slots);
}

/**
 * @param {string} rootSelector - container with .otp-slot inputs
 * @param {string} hiddenId - hidden input to store joined digits
 */
export function clearOtpSlots(rootSelector) {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    root.querySelectorAll('.otp-slot').forEach((s) => { s.value = ''; });
}

export function bindOtpSlotGroup(rootSelector, hiddenId) {
    const root = document.querySelector(rootSelector);
    const hidden = document.getElementById(hiddenId);
    if (!root || !hidden) return;

    const slots = root.querySelectorAll('.otp-slot');
    if (!slots.length) return;

    slots.forEach((slot, i) => {
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !slot.value && i > 0) {
                slots[i - 1].focus();
                slots[i - 1].value = '';
                otpSyncHidden(slots, hidden);
                e.preventDefault();
            }
        });
        slot.addEventListener('input', () => {
            slot.value = (slot.value || '').replace(/\D/g, '').slice(-1);
            otpSyncHidden(slots, hidden);
            if (slot.value && i < slots.length - 1) slots[i + 1].focus();
        });
        slot.addEventListener('paste', (e) => {
            e.preventDefault();
            const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, slots.length);
            for (let j = 0; j < slots.length; j++) {
                slots[j].value = t[j] || '';
            }
            otpSyncHidden(slots, hidden);
            const next = Math.min(t.length, slots.length - 1);
            slots[next].focus();
        });
    });
}

function formatDisplayDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {string} triggerId
 * @param {string} popoverId
 * @param {string} hiddenInputId - native date value YYYY-MM-DD
 * @param {string} labelId - button text span
 */
export function bindDatePickerPopover(triggerId, popoverId, hiddenInputId, labelId) {
    const trigger = document.getElementById(triggerId);
    const pop = document.getElementById(popoverId);
    const hidden = document.getElementById(hiddenInputId);
    const label = document.getElementById(labelId);
    const grid = document.getElementById(`${popoverId}-grid`);
    if (!trigger || !pop || !hidden || !label) return;

    const mainScroll = document.querySelector('.main-content');
    let repositionHandlersBound = false;

    function positionPopover() {
        if (pop.classList.contains('hidden')) return;
        const pad = 8;
        const r = trigger.getBoundingClientRect();
        pop.style.position = 'fixed';
        const pw = pop.offsetWidth || 280;
        const ph = pop.offsetHeight || 300;
        let left = Math.min(Math.max(pad, r.left), window.innerWidth - pw - pad);
        let top = r.bottom + pad;
        if (top + ph > window.innerHeight - pad && r.top - ph - pad >= pad) {
            top = r.top - ph - pad;
        }
        if (top + ph > window.innerHeight - pad) {
            top = Math.max(pad, window.innerHeight - ph - pad);
        }
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    }

    function bindRepositionWhileOpen() {
        if (repositionHandlersBound) return;
        repositionHandlersBound = true;
        window.addEventListener('resize', positionPopover);
        if (mainScroll) mainScroll.addEventListener('scroll', positionPopover, { passive: true });
    }

    function unbindReposition() {
        if (!repositionHandlersBound) return;
        repositionHandlersBound = false;
        window.removeEventListener('resize', positionPopover);
        if (mainScroll) mainScroll.removeEventListener('scroll', positionPopover);
    }

    let view = new Date();
    if (hidden.value) {
        const [y, m, d] = hidden.value.split('-').map(Number);
        if (y) view = new Date(y, m - 1, d || 1);
    }

    function monthMatrix(y, mon) {
        const first = new Date(y, mon, 1);
        const startDow = first.getDay();
        const dim = new Date(y, mon + 1, 0).getDate();
        const cells = [];
        let d = 1 - startDow;
        for (let i = 0; i < 42; i++, d++) {
            if (d < 1 || d > dim) cells.push(null);
            else cells.push(d);
        }
        return cells;
    }

    function renderCal() {
        if (!grid) return;
        const y = view.getFullYear();
        const mon = view.getMonth();
        const title = pop.querySelector('.date-picker-popover-title');
        if (title) title.textContent = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

        const cells = monthMatrix(y, mon);
        grid.innerHTML = '';
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        cells.forEach((day) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'date-picker-day';
            if (day == null) {
                btn.classList.add('date-picker-day--empty');
                btn.disabled = true;
                btn.textContent = '';
            } else {
                const iso = `${y}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                btn.textContent = String(day);
                btn.classList.toggle('date-picker-day--today', iso === todayStr);
                btn.classList.toggle('date-picker-day--selected', hidden.value === iso);
                btn.addEventListener('click', () => {
                    hidden.value = iso;
                    label.textContent = formatDisplayDate(iso);
                    trigger.setAttribute('data-empty', 'false');
                    pop.classList.add('hidden');
                    unbindReposition();
                    hidden.dispatchEvent(new Event('change', { bubbles: true }));
                    trigger.setAttribute('aria-expanded', 'false');
                    renderCal();
                });
            }
            grid.appendChild(btn);
        });
    }

    pop.querySelector('.date-picker-prev')?.addEventListener('click', () => {
        view.setMonth(view.getMonth() - 1);
        renderCal();
    });
    pop.querySelector('.date-picker-next')?.addEventListener('click', () => {
        view.setMonth(view.getMonth() + 1);
        renderCal();
    });

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = !pop.classList.contains('hidden');
        document.querySelectorAll('.date-picker-popover').forEach((p) => {
            p.classList.add('hidden');
        });
        unbindReposition();
        if (wasOpen) {
            trigger.setAttribute('aria-expanded', 'false');
            return;
        }
        if (hidden.value) {
            const [y, m, d] = hidden.value.split('-').map(Number);
            if (y) view = new Date(y, (m || 1) - 1, d || 1);
        }
        pop.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        renderCal();
        requestAnimationFrame(() => {
            positionPopover();
            bindRepositionWhileOpen();
        });
    });

    document.addEventListener('click', (e) => {
        if (!pop.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
            pop.classList.add('hidden');
            unbindReposition();
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    if (hidden.value) {
        label.textContent = formatDisplayDate(hidden.value);
        trigger.setAttribute('data-empty', 'false');
    } else {
        label.textContent = 'Pick a date';
        trigger.setAttribute('data-empty', 'true');
    }
    renderCal();
}

// ====== Utilities ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
// === Gemini proxy endpoint (your Cloudflare Worker) ===
const WORKER_GEMINI_URL = "https://souschef-proxy.marinaxu99.workers.dev/api/gemini";


// Measure the sticky topbar and keep tabs aligned underneath it
function updateTopbarHeight() {
    const tb = document.querySelector('.topbar');
    if (!tb) return;
    const h = tb.offsetHeight; // includes wrapping/rows
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
}
// Recalculate on load, after fonts, and on resize/orientation changes
window.addEventListener('load', updateTopbarHeight);
window.addEventListener('resize', updateTopbarHeight);
window.addEventListener('orientationchange', updateTopbarHeight);
// Font Loading API: recalc when fonts finish
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateTopbarHeight);
}
// Also run immediately
updateTopbarHeight();

// ====== Storage keys (UNCHANGED to preserve your data) ======
const STORAGE_KEY = 'wineLog.entries.v1';
const THEME_KEY = 'wineLog.theme';
const LAST_NEW_TYPE = 'wineLog.lastNewType';
const LAST_TAB = 'wineLog.lastTab';

function loadEntries() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}
function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function setTheme(mode) {
    const root = document.documentElement;
    if (mode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem(THEME_KEY, mode);
}
function getTheme() { return localStorage.getItem(THEME_KEY) || 'light'; }

function setLastTab(id) { localStorage.setItem(LAST_TAB, id); }
function getLastTab() { return localStorage.getItem(LAST_TAB) || 'whiteForm'; }
function setLastNewType(t) { localStorage.setItem(LAST_NEW_TYPE, t); }
function getLastNewType() { return localStorage.getItem(LAST_NEW_TYPE) || 'white'; }

// ====== Tabs & Theme ======
$$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.tab').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const target = btn.dataset.tab;
        $$('.tabpanel').forEach(p => p.classList.remove('active'));
        $('#' + target).classList.add('active');
        setLastTab(target);

        if (target === 'publicView') loadPublicSnapshot();

    });
});

(function initTab() {
    const target = getLastTab();
    switchTo(target);
    if (target === 'publicView') loadPublicSnapshot();
})();


// theme toggle
const themeBtn = $('#toggleTheme');
function refreshThemeButton() {
    themeBtn.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
}
themeBtn.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    refreshThemeButton();
});
setTheme(getTheme());
refreshThemeButton();

// ====== Data & State ======
const listEl = $('#logList');
const searchEl = $('#search');        // logs-local search
const globalSearchEl = $('#globalSearch');  // topbar global search
const chipsEl = $('#typeChips');

let entries = loadEntries();
let currentDetailId = null;

// ====== Migration: ensure like fields exist (preserves existing data) ======
entries = entries.map(e => ({
    likes: 0,
    liked: false,
    ...e,
    likes: typeof e.likes === 'number' ? e.likes : 0,
    liked: typeof e.liked === 'boolean' ? e.liked : false
}));
saveEntries(entries);

// ====== Helpers ======
async function readFileAsDataURL(file) {
    if (!file) return '';
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
    });
}
function getCheckedValues(inputs) {
    return inputs.filter(i => i.checked).map(i => i.value);
}

// ====== Forms to JSON ======
async function collectForm(form, type, existingPhoto = '') {
    const fd = new FormData(form);
    const entry = {
        id: uid(),
        type,
        date: new Date().toISOString(),
        name: (fd.get('name') || '').toString().trim(),
        notes: (fd.get('notes') || '').toString(),
    };

    // Shared
    entry.appearance_clarity = fd.get('appearance_clarity') || '';
    entry.hue_density = fd.get('hue_density') || '';
    entry.hue = fd.get('hue') || '';
    entry.smell_intensity = fd.get('smell_intensity') || '';

    // NOSE descriptors
    if (type === 'white') entry.smell_fresh = getCheckedValues($$('input[name="smell_fresh"]', form));
    else entry.smell_fruit_red = getCheckedValues($$('input[name="smell_fruit_red"]', form));
    entry.smell_other = getCheckedValues($$('input[name="smell_other"]', form));
    entry.smell_other_text = (fd.get('smell_other_text') || '').toString();

    // PALATE basics
    entry.sweetness = fd.get('sweetness') || '';
    entry.sourness = fd.get('sourness') || '';
    entry.bitterness = fd.get('bitterness') || '';
    entry.astringency = fd.get('astringency') || '';

    // PALATE descriptors
    if (type === 'white') entry.palate_fresh = getCheckedValues($$('input[name="palate_fresh"]', form));
    else entry.palate_fruit_red = getCheckedValues($$('input[name="palate_fruit_red"]', form));
    entry.palate_other = getCheckedValues($$('input[name="palate_other"]', form));
    entry.palate_other_text = (fd.get('palate_other_text') || '').toString();

    // Structure
    entry.body = fd.get('body') || '';
    entry.texture = fd.get('texture') || '';
    entry.balance = fd.get('balance') || '';
    entry.finish = fd.get('finish') || '';

    const removeRequested = fd.get('remove_photo') === 'on';
    // Photo (shrink before saving)
    const photoFile = fd.get('photo');
    if (removeRequested) {
        entry.photo = '';
    } else if (photoFile && photoFile.size) {
        const raw = await readFileAsDataURL(photoFile);
        entry.photo = await shrinkDataURL(raw, { maxWidth: 900, maxBytes: 150 * 1024 });
    } else {
        entry.photo = existingPhoto || '';
    }

    return entry;
}

// ====== Rendering ======
// NEW: concise smell + palate meta for the Logs row
function shortMeta(e) {
    const take = (arr, n = 2) => (arr || []).filter(Boolean).slice(0, n);

    // Build "nose" list
    const nose =
        e.type === 'white'
            ? [...take(e.smell_fresh, 2), ...take(e.smell_other, 1)]
            : [...take(e.smell_fruit_red, 2), ...take(e.smell_other, 1)];
    if (e.smell_other_text) nose.push(e.smell_other_text);

    // Build "palate" list
    const palate =
        e.type === 'white'
            ? [...take(e.palate_fresh, 2), ...take(e.palate_other, 1)]
            : [...take(e.palate_fruit_red, 2), ...take(e.palate_other, 1)];
    if (e.palate_other_text) palate.push(e.palate_other_text);

    const noseStr = nose.filter(Boolean).slice(0, 3).join(', ') || '-';
    const palateStr = palate.filter(Boolean).slice(0, 3).join(', ') || '-';

    // Example result: "cherry, blackberry • oak"
    return `${noseStr} • ${palateStr}`;
}

function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const ft = ($('.chip.selected', chipsEl) || {}).dataset?.type || '';

    const filtered = entries.filter(e => {
        const matchQ = !q || (e.name?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q));
        const matchT = !ft || e.type === ft;
        return matchQ && matchT;
    });

    listEl.innerHTML = '';
    filtered
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(e => {
            const li = document.createElement('li');

            // Row
            const row = document.createElement('div');
            row.className = 'row row-main';

            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = e.name || '(no name)';

            const meta = document.createElement('div');
            meta.className = 'meta';
            const dt = new Date(e.date).toLocaleString();
            meta.textContent = `${e.type.toUpperCase()} • ${shortMeta(e)} • ${dt}`;

            left.appendChild(title);
            left.appendChild(meta);

            const right = document.createElement('div');
            right.className = 'row-actions';

            const btnOpen = document.createElement('button');
            btnOpen.className = 'iconbtn';
            btnOpen.title = 'Open detail';
            btnOpen.textContent = '📂';

            const btnEdit = document.createElement('button');
            btnEdit.className = 'iconbtn';
            btnEdit.title = 'Edit';
            btnEdit.textContent = '✏️';

            const btnDelete = document.createElement('button');
            btnDelete.className = 'iconbtn';
            btnDelete.title = 'Delete';
            btnDelete.textContent = '🗑';

            // Like button
            const btnLike = document.createElement('button');
            btnLike.className = 'iconbtn like';
            btnLike.title = 'Like';
            btnLike.setAttribute('aria-pressed', e.liked ? 'true' : 'false');
            btnLike.innerHTML = (e.liked ? '♥' : '♡') + `<span class="like-count">${e.likes || 0}</span>`;

            const chev = document.createElement('span');
            chev.className = 'chev';
            chev.textContent = '›';

            right.appendChild(btnOpen);
            right.appendChild(btnEdit);
            right.appendChild(btnDelete);
            right.appendChild(btnLike);
            right.appendChild(chev);

            row.appendChild(left);
            row.appendChild(right);

            // Inline expand preview
            const expand = document.createElement('div');
            expand.className = 'row-expand';
            expand.innerHTML = buildPreviewHTML(e);

            // Events
            row.addEventListener('click', (ev) => {
                if (ev.target === btnOpen || ev.target === btnEdit || ev.target === btnDelete || ev.target === btnLike || btnLike.contains(ev.target)) return;
                li.classList.toggle('expanded');
                chev.textContent = li.classList.contains('expanded') ? '˅' : '›';
            });
            btnOpen.addEventListener('click', (ev) => { ev.stopPropagation(); openDetail(e.id); });
            btnEdit.addEventListener('click', (ev) => { ev.stopPropagation(); startEdit(e.id); });
            btnDelete.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (confirm('Delete this entry?')) {
                    entries = entries.filter(x => x.id !== e.id);
                    saveEntries(entries);
                    renderList();
                    updateTabCounts();
                }
            });
            btnLike.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const idx = entries.findIndex(x => x.id === e.id);
                if (idx < 0) return;
                const curr = entries[idx];
                const nextLiked = !curr.liked;
                const nextLikes = Math.max(0, (curr.likes || 0) + (nextLiked ? 1 : -1));
                entries[idx] = { ...curr, liked: nextLiked, likes: nextLikes };
                saveEntries(entries);
                btnLike.setAttribute('aria-pressed', nextLiked ? 'true' : 'false');
                btnLike.innerHTML = (nextLiked ? '♥' : '♡') + `<span class="like-count">${nextLikes}</span>`;
            });

            li.appendChild(row);
            li.appendChild(expand);
            listEl.appendChild(li);
        });

    updateTabCounts();
}

function buildPreviewHTML(e) {
    const kv = (k, v) => `<div class="k">${k}</div><div class="v">${Array.isArray(v) ? v.join(', ') : (v || '')}</div>`;
    let html = `<div class="preview"><div class="kv">`;
    html += kv('Appearance clarity', e.appearance_clarity);
    html += kv('Hue density', e.hue_density);
    html += kv('Hue', e.hue);
    html += kv('Smell intensity', e.smell_intensity);
    if (e.type === 'white') html += kv('Nose fresh fruit', e.smell_fresh);
    else html += kv('Nose fruit', e.smell_fruit_red);
    html += kv('Nose (other)', [...(e.smell_other || []), e.smell_other_text].filter(Boolean));
    html += kv('Sweetness', e.sweetness);
    html += kv('Sourness', e.sourness);
    html += kv('Bitterness', e.bitterness);
    html += kv('Astringency', e.astringency);
    if (e.type === 'white') html += kv('Palate/finish — fresh fruit', e.palate_fresh);
    else html += kv('Palate/finish — fruit', e.palate_fruit_red);
    html += kv('Palate/finish (other)', [...(e.palate_other || []), e.palate_other_text].filter(Boolean));
    html += kv('Body', e.body);
    html += kv('Texture', e.texture);
    html += kv('Balance', e.balance);
    html += kv('Finish', e.finish);
    html += kv('Notes', e.notes);
    html += `</div>`;
    if (e.photo) html += `<div><img class="thumb" src="${e.photo}" alt="photo" /></div>`;
    html += `</div>`;
    return html;
}
function kv(label, value) {
    const safe = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));
    return `<div class="k">${label}</div><div class="v">${safe(value)}</div>`;
}

function openDetail(id) {
    $('#editEntry').style.display = '';
    $('#deleteEntry').style.display = '';
    currentDetailId = id;
    const e = entries.find(x => x.id === id);
    if (!e) return;
    const art = $('#detailContent');
    let html = `<h3>${e.name || '(no name)'} — ${e.type.toUpperCase()}</h3><div class="kv">`;
    html += kv('Appearance clarity', e.appearance_clarity);
    html += kv('Hue density', e.hue_density);
    html += kv('Hue', e.hue);
    html += kv('Smell intensity', e.smell_intensity);
    if (e.type === 'white') html += kv('Smell descriptors: fresh fruit', e.smell_fresh);
    else html += kv('Smell descriptors: fruit', e.smell_fruit_red);
    html += kv('Smell descriptors (other)', [...(e.smell_other || []), e.smell_other_text].filter(Boolean));
    html += kv('Sweetness', e.sweetness);
    html += kv('Sourness', e.sourness);
    html += kv('Bitterness', e.bitterness);
    html += kv('Astringency', e.astringency);
    if (e.type === 'white') html += kv('Palate/finish — fresh fruit', e.palate_fresh);
    else html += kv('Palate/finish — fruit', e.palate_fruit_red);
    html += kv('Palate/finish (other)', [...(e.palate_other || []), e.palate_other_text].filter(Boolean));
    html += kv('Body', e.body);
    html += kv('Texture', e.texture);
    html += kv('Balance', e.balance);
    html += kv('Finish', e.finish);
    html += kv('Side notes', e.notes);
    html += `</div>`;
    if (e.photo) html += `<img class="img-preview" src="${e.photo}" alt="photo" />`;
    art.innerHTML = html;
    const dlg = $('#detailDialog');
    dlg.showModal();

    // reset scroll to top
    requestAnimationFrame(() => {
        art.scrollTop = 0;
        dlg.scrollTop = 0;
    });
}
$('#closeDetail').addEventListener('click', () => $('#detailDialog').close());
$('#deleteEntry').addEventListener('click', () => {
    if (!currentDetailId) return;
    entries = entries.filter(e => e.id !== currentDetailId);
    saveEntries(entries);
    renderList();
    updateTabCounts();
    $('#detailDialog').close();
});
$('#editEntry').addEventListener('click', () => {
    if (!currentDetailId) return;
    startEdit(currentDetailId);
    $('#detailDialog').close();
});

function startEdit(id) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    const targetTab = e.type === 'white' ? 'whiteForm' : 'redForm';
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === targetTab));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === targetTab));
    setLastTab(targetTab);
    fillForm(e);
}

function fillForm(e) {
    const form = e.type === 'white' ? $('#formWhite') : $('#formRed');
    form.reset();

    form.name.value = e.name || '';
    setRadio(form, 'appearance_clarity', e.appearance_clarity);
    setRadio(form, 'hue_density', e.hue_density);
    setRadio(form, 'hue', e.hue);
    setRadio(form, 'smell_intensity', e.smell_intensity);

    if (e.type === 'white') setChecks(form, 'smell_fresh', e.smell_fresh || []);
    else setChecks(form, 'smell_fruit_red', e.smell_fruit_red || []);
    setChecks(form, 'smell_other', e.smell_other || []);
    if (form.smell_other_text) form.smell_other_text.value = e.smell_other_text || '';

    setRadio(form, 'sweetness', e.sweetness);
    setRadio(form, 'sourness', e.sourness);
    setRadio(form, 'bitterness', e.bitterness);
    setRadio(form, 'astringency', e.astringency);

    if (e.type === 'white') setChecks(form, 'palate_fresh', e.palate_fresh || []);
    else setChecks(form, 'palate_fruit_red', e.palate_fruit_red || []);
    setChecks(form, 'palate_other', e.palate_other || []);
    if (form.palate_other_text) form.palate_other_text.value = e.palate_other_text || '';

    setRadio(form, 'body', e.body);
    setRadio(form, 'texture', e.texture);
    setRadio(form, 'balance', e.balance);
    setRadio(form, 'finish', e.finish);

    form.notes.value = e.notes || '';

    // --- Photo preview block (no duplicate IDs) ---
    const fileInput = form.querySelector('input[name="photo"]');

    // Container next to the file input
    let holder = form.querySelector('[data-role="currentPhotoPreview"]');
    if (!holder) {
        holder = document.createElement('div');
        holder.dataset.role = 'currentPhotoPreview';
        holder.className = 'meta';
        fileInput.closest('label').after(holder);
    }

    // Optional "remove photo" control
    let removeWrap = form.querySelector('[data-role="removePhotoWrap"]');
    if (!removeWrap) {
        removeWrap = document.createElement('label');
        removeWrap.dataset.role = 'removePhotoWrap';
        removeWrap.style.display = 'inline-flex';
        removeWrap.style.alignItems = 'center';
        removeWrap.style.gap = '6px';
        removeWrap.innerHTML = `<input type="checkbox" name="remove_photo"> Remove photo`;
        holder.after(removeWrap);
    }
    // default unchecked each time we enter edit
    const removeChk = form.querySelector('input[name="remove_photo"]');
    removeChk.checked = false;

    // Render current photo (if any)
    const renderPreview = (src) => {
        holder.innerHTML = src
            ? `<img src="${src}" alt="current photo" style="max-width:160px;border:1px solid var(--border);border-radius:10px;margin-top:6px;">`
            : `<span>No photo attached.</span>`;
    };
    renderPreview(e.photo || '');

    // Live preview when user selects a new file
    fileInput.onchange = async () => {
        const f = fileInput.files?.[0];
        if (!f) { renderPreview(e.photo || ''); return; }
        const reader = new FileReader();
        reader.onload = () => renderPreview(reader.result);
        reader.readAsDataURL(f);
        removeChk.checked = false; // picking a file implies "don’t remove"
    };

    form.dataset.editId = e.id;
}


function setRadio(form, name, value) {
    const el = $$(`input[name="${name}"]`, form).find(i => i.value === value);
    if (el) el.checked = true;
}
function setChecks(form, name, values) {
    $$(`input[name="${name}"]`, form).forEach(i => { i.checked = values.includes(i.value); });
}

// ====== Submit Handlers ======
$('#formWhite').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const editingId = form.dataset.editId;
    const existingPhoto = editingId ? (entries.find(e => e.id === editingId)?.photo || '') : '';
    const data = await collectForm(form, 'white', existingPhoto);

    if (editingId) {
        const idx = entries.findIndex(e => e.id === editingId);
        if (idx >= 0) {
            // preserve likes/liked/isPublic from existing record
            entries[idx] = { ...entries[idx], ...data, id: editingId };
        }
        form.dataset.editId = '';
    } else {
        // NEW entry: set defaults once
        entries.push({ ...data, likes: 0, liked: false, isPublic: false });
    }

    try {
        saveEntries(entries);
    } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
            alert('Storage is full. Try removing a few photos or shrinking them.');
        } else {
            console.error(e);
            alert('Could not save. See console for details.');
        }
        return; // stop further code if save failed
    }

    form.reset();
    renderList();
    updateTabCounts();
    switchTo('logsView');
});


$('#formRed').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const editingId = form.dataset.editId;
    const existingPhoto = editingId ? (entries.find(e => e.id === editingId)?.photo || '') : '';
    const data = await collectForm(form, 'red', existingPhoto);

    if (editingId) {
        const idx = entries.findIndex(e => e.id === editingId);
        if (idx >= 0) {
            // preserve likes/liked/isPublic from existing record
            entries[idx] = { ...entries[idx], ...data, id: editingId };
        }
        form.dataset.editId = '';
    } else {
        // NEW entry: set defaults once
        entries.push({ ...data, likes: 0, liked: false, isPublic: false });
    }

    try {
        saveEntries(entries);
    } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
            alert('Storage is full. Try removing a few photos or shrinking them.');
        } else {
            console.error(e);
            alert('Could not save. See console for details.');
        }
        return; // stop further code if save failed
    }

    form.reset();
    renderList();
    updateTabCounts();
    switchTo('logsView');
});


function switchTo(id) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === id));
    setLastTab(id);
    if (id === 'publicView') loadPublicSnapshot();
}


// ====== Search / Filter / Clear ======
searchEl.addEventListener('input', renderList);

// chips: type filter
chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $$('.chip', chipsEl).forEach(c => c.classList.remove('selected'));
    btn.classList.add('selected');
    renderList();
});

// topbar global search
globalSearchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        switchTo('logsView');
        searchEl.value = globalSearchEl.value.trim();
        renderList();
    }
});
document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        globalSearchEl.focus();
    }
});

// ====== Count badges ======
function updateTabCounts() {
    const white = entries.filter(e => e.type === 'white').length;
    const red = entries.filter(e => e.type === 'red').length;
    $('#countWhite').textContent = white;
    $('#countRed').textContent = red;
    $('#countAll').textContent = entries.length;
}

// ====== Chat (replaces old Quick Add FAB behavior) ======

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

// === Floating Chat Bubble toggle ===
const fabQuickAdd = document.getElementById('fabQuickAdd');
const chatDialog = document.getElementById('chatDialog');

// helper: toggle open attribute (since <dialog> showModal is disabled)
fabQuickAdd.addEventListener('click', () => {
    if (chatDialog.hasAttribute('open')) {
        chatDialog.removeAttribute('open');
    } else {
        chatDialog.setAttribute('open', '');
    }
});

// close button inside chat
chatDialog.querySelector('button[value="close"]').addEventListener('click', () => {
    chatDialog.removeAttribute('open');
});



// simple rolling history
let chatHistory = [];

function appendMessage(role, text) {
    // role: 'user' | 'model'
    chatHistory.push({ role, text });

    const wrap = document.createElement('div');
    wrap.className = 'bubble';

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = role === 'user' ? 'You' : 'Gemini';

    const msg = document.createElement('div');
    msg.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
    msg.textContent = text;

    wrap.appendChild(who);
    wrap.appendChild(msg);
    chatMessages.appendChild(wrap);

    // autoscroll
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setSending(disabled) {
    chatSend.disabled = disabled;
    chatInput.disabled = disabled;
}

fabChat?.addEventListener('click', () => {
    // show modal; clear ephemeral placeholders
    if (!chatDialog.open) chatDialog.showModal();
    // focus input
    setTimeout(() => chatInput.focus(), 50);
});

chatSend?.addEventListener('click', async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage('user', text);
    chatInput.value = '';
    setSending(true);

    try {
        const reply = await callGemini({
            history: chatHistory.slice(-10), // keep last 10 turns
            userText: text
        });
        appendMessage('model', reply);
    } catch (err) {
        console.error(err);
        appendMessage('model', 'Oops — I couldn’t reach Gemini. Please try again.');
    } finally {
        setSending(false);
        chatInput.focus();
    }
});


// Enter to send (Shift+Enter for newline)
chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatSend.click();
    }
});


// ====== Gemini helpers (via Cloudflare Worker; no browser API key) ======

// Convert our rolling history to Gemini "contents" format
function toGeminiContents(history) {
    // history items: {role: 'user'|'model', text: string}
    return history.map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }]
    }));
}

async function callGemini({ history, userText }) {
    // System prompt tailored to wine vocab + concise coaching
    const systemInstruction = {
        role: 'system',
        parts: [{
            text: [
                'You are a concise vocabulary coach for wine tasting and general English.',
                'When asked about wine notes (e.g., oak, vanilla, lees, malolactic), give',
                'short definitions plus 1–2 usage examples in tasting context.',
                'If asked non-wine vocab, still answer concisely with plain-English examples.',
                'Prefer bullet points when it improves clarity. Keep answers compact.'
            ].join(' ')
        }]
    };

    const contents = toGeminiContents(
        history.concat([{ role: 'user', text: userText }])
    );

    const body = {
        // NOTE: the Worker picks the model (gemini-2.5-flash) server-side.
        systemInstruction,         // camelCase per v1beta spec
        contents,
        generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 512
        }
    };

    const res = await fetch(WORKER_GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Gemini proxy error ${res.status}: ${txt || res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('\n').trim();
    return text || '(no response)';
}




// ====== Public Logs (loader + renderer) ======
async function loadPublicSnapshot() {
    const list = $('#publicLogList');
    if (!list) return;

    list.innerHTML = '<li class="row"><div class="meta">Loading…</div></li>';
    try {
        const res = await fetch('data/public-logs.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const entries = await res.json();
        renderPublicList(entries);
    } catch (err) {
        console.warn('Public logs not available:', err);
        list.innerHTML = '<li class="row"><div class="meta">No public logs found.</div></li>';
    }
}

function renderPublicList(entries) {
    const list = $('#publicLogList');
    list.innerHTML = '';

    if (!entries || !entries.length) {
        list.innerHTML = '<li class="row"><div class="meta">No entries yet.</div></li>';
        return;
    }

    entries
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(e => {
            const li = document.createElement('li'); // styled by .list li

            const row = document.createElement('div');
            row.className = 'row';
            row.style.cursor = 'pointer';                // <— clickable
            row.title = 'Open details';

            const preview = document.createElement('div');
            preview.className = 'preview';

            const left = document.createElement('div');
            if (e.photo) {
                const img = document.createElement('img');
                img.className = 'thumb';
                img.src = e.photo;
                img.alt = 'photo';
                left.appendChild(img);
            }
            preview.appendChild(left);

            const right = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = e.name || '(no name)';

            const meta = document.createElement('div');
            meta.className = 'meta';
            const dt = new Date(e.date).toLocaleString();
            const metaText = (typeof shortMeta === 'function')
                ? `${(e.type || '').toUpperCase()} • ${shortMeta(e)} • ${dt}`
                : `${(e.type || '').toUpperCase()} • ${dt}`;
            meta.textContent = metaText;

            right.append(title, meta);
            preview.appendChild(right);

            row.appendChild(preview);
            li.appendChild(row);
            list.appendChild(li);

            // OPEN READ-ONLY DETAIL ON CLICK
            row.addEventListener('click', () => openPublicDetail(e));
        });
}

function getFilteredForExport() {
    const q = (document.querySelector('#search')?.value || '').trim().toLowerCase();
    const chipsEl = document.querySelector('#typeChips');
    const activeChip = chipsEl ? chipsEl.querySelector('.chip.selected') : null;
    const ft = activeChip ? activeChip.dataset.type : '';
    const all = JSON.parse(localStorage.getItem('wineLog.entries.v1') || '[]');
    return all
        .filter(e => {
            const matchQ = !q || (e.name?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q));
            const matchT = !ft || e.type === ft;
            return matchQ && matchT;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function forceDownload(filename, blob) {
    // Create a persistent hidden anchor (Safari-friendly)
    let a = document.getElementById('__dl_anchor__');
    if (!a) {
        a = document.createElement('a');
        a.id = '__dl_anchor__';
        a.style.display = 'none';
        document.body.appendChild(a);
    }
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    // Click synchronously in same task to avoid popup blockers
    a.click();
    // Cleanup shortly after
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportPublic')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';

    try {
        const source = getFilteredForExport();
        const MAX_WIDTH = 1200, JPEG_QUALITY = 0.85;

        // Include photos (lightly shrunk)
        const out = [];
        for (const e of source) {
            const copy = { ...e };
            if (copy.photo) copy.photo = await shrinkDataURL(copy.photo, MAX_WIDTH, JPEG_QUALITY);
            out.push(copy);
        }

        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        forceDownload('public-logs.json', blob);

        // Optional feedback
        setTimeout(() => { btn.textContent = 'Exported ✓'; }, 50);
    } catch (err) {
        console.error(err);
        alert('Export failed. Check the console for details.');
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 700);
    }
});

// Shrink to max width and max bytes (loops quality down until under cap)
async function shrinkDataURL(dataURL, {
    maxWidth = 900,
    startQuality = 0.8,
    minQuality = 0.5,
    maxBytes = 150 * 1024 // 150 KB target
} = {}) {
    try {
        if (!dataURL || !dataURL.startsWith('data:image')) return dataURL;

        const img = new Image();
        img.src = dataURL;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(img, 0, 0, w, h);

        let q = startQuality, out = canvas.toDataURL('image/jpeg', q);

        // Loop down quality until <= maxBytes or reach minQuality
        while ((out.length * 0.75) > maxBytes && q > minQuality) {
            q = Math.max(minQuality, q - 0.05);
            out = canvas.toDataURL('image/jpeg', q);
        }
        return out;
    } catch {
        return dataURL; // fail-safe
    }
}


function openPublicDetail(entry) {
    // Build detail content using the same kv/markup as private detail
    const art = $('#detailContent');
    let html = `<h3>${entry.name || '(no name)'} — ${(entry.type || '').toUpperCase()}</h3><div class="kv">`;
    html += kv('Appearance clarity', entry.appearance_clarity);
    html += kv('Hue density', entry.hue_density);
    html += kv('Hue', entry.hue);
    html += kv('Smell intensity', entry.smell_intensity);
    if (entry.type === 'white') html += kv('Smell descriptors: fresh fruit', entry.smell_fresh);
    else html += kv('Smell descriptors: fruit', entry.smell_fruit_red);
    html += kv('Smell descriptors (other)', [...(entry.smell_other || []), entry.smell_other_text].filter(Boolean));
    html += kv('Sweetness', entry.sweetness);
    html += kv('Sourness', entry.sourness);
    html += kv('Bitterness', entry.bitterness);
    html += kv('Astringency', entry.astringency);
    if (entry.type === 'white') html += kv('Palate/finish — fresh fruit', entry.palate_fresh);
    else html += kv('Palate/finish — fruit', entry.palate_fruit_red);
    html += kv('Palate/finish (other)', [...(entry.palate_other || []), entry.palate_other_text].filter(Boolean));
    html += kv('Body', entry.body);
    html += kv('Texture', entry.texture);
    html += kv('Balance', entry.balance);
    html += kv('Finish', entry.finish);
    html += kv('Side notes', entry.notes);
    html += `</div>`;
    if (entry.photo) html += `<img class="img-preview" src="${entry.photo}" alt="photo" />`;
    art.innerHTML = html;

    // Hide edit/delete (read-only mode)
    $('#editEntry').style.display = 'none';
    $('#deleteEntry').style.display = 'none';

    const dlg = $('#detailDialog');
    dlg.showModal();

    // reset scroll to top
    requestAnimationFrame(() => {
        art.scrollTop = 0;
        dlg.scrollTop = 0;
    });
}


// ====== Init ======
function initChipsFromHash() {
    // optional: restore type chip via hash like #type=red
    try {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        const t = params.get('type');
        if (t === 'white' || t === 'red' || t === '') {
            $$('.chip', chipsEl).forEach(c => c.classList.toggle('selected', c.dataset.type === (t ?? '')));
        }
    } catch { }
}
initChipsFromHash();
renderList();
updateTabCounts();
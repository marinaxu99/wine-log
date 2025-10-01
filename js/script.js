// ====== Utilities ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
    });
});

// restore last tab on load
(function initTab() {
    const target = getLastTab();
    switchTo(target);
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
async function collectForm(form, type) {
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

    // Photo
    const photoFile = fd.get('photo');
    entry.photo = photoFile && photoFile.size ? await readFileAsDataURL(photoFile) : '';

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
    $('#detailDialog').showModal();
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
    form.dataset.editId = e.id; // stash id for overwrite on submit
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
    const data = await collectForm(form, 'white');

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

    saveEntries(entries);
    form.reset();
    renderList();
    updateTabCounts();
    switchTo('logsView');
});


$('#formRed').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const editingId = form.dataset.editId;
    const data = await collectForm(form, 'red');

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

    saveEntries(entries);
    form.reset();
    renderList();
    updateTabCounts();
    switchTo('logsView');
});


function switchTo(id) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === id));
    setLastTab(id);

    if (id === 'publicView') {
        loadPublicSnapshot();
    }
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

// ====== Quick Add ======
const quickAddDialog = $('#quickAddDialog');
const quickAddForm = $('#quickAddForm');
const quickAddSave = $('#quickAddSave');
const fab = $('#fabQuickAdd');

fab.addEventListener('click', () => {
    quickAddForm.reset();
    quickAddDialog.showModal();
});
quickAddSave.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(quickAddForm);
    const name = (fd.get('name') || '').toString().trim();
    const type = (fd.get('type') || 'white').toString();

    if (!name) {
        alert('Please enter a name');
        return;
    }
    const photoFile = fd.get('photo');
    const entry = {
        id: uid(),
        type,
        date: new Date().toISOString(),
        name,
        notes: '',
        appearance_clarity: '',
        hue_density: '',
        hue: '',
        smell_intensity: '',
        smell_fresh: [],
        smell_fruit_red: [],
        smell_other: [],
        smell_other_text: '',
        sweetness: '',
        sourness: '',
        bitterness: '',
        astringency: '',
        palate_fresh: [],
        palate_fruit_red: [],
        palate_other: [],
        palate_other_text: '',
        body: '',
        texture: '',
        balance: '',
        finish: '',
        photo: photoFile && photoFile.size ? await readFileAsDataURL(photoFile) : '',
        likes: 0,
        liked: false
    };

    entries.push(entry);
    saveEntries(entries);
    renderList();
    updateTabCounts();
    quickAddDialog.close();

    // Jump user into full form for refinement
    setLastNewType(type);
    startEdit(entry.id);
});

// ====== Public Logs ======
async function loadPublicSnapshot() {
    try {
        const res = await fetch('data/public-logs.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const entries = await res.json();
        renderPublicList(entries);
    } catch (err) {
        console.warn('Public logs not available:', err);
        $('#publicLogList').innerHTML =
            '<li class="meta">No public logs found.</li>';
    }
}

function renderPublicList(entries) {
    const list = $('#publicLogList');
    list.innerHTML = '';
    if (!entries.length) {
        list.innerHTML = '<li class="meta">No entries yet.</li>';
        return;
    }
    entries
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(e => {
            const li = document.createElement('li');
            li.className = 'row';
            li.textContent = `${e.type.toUpperCase()} • ${e.name || '(no name)'}`;
            list.appendChild(li);
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
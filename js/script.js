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

// If browser supports the Font Loading API, recalc when fonts finish (prevents overlap after webfonts swap in)
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateTopbarHeight);
}

// Also run immediately in case JS loads after DOM is ready
updateTopbarHeight();


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
function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
}
function setLastTab(id) { localStorage.setItem(LAST_TAB, id); }
function getLastTab() { return localStorage.getItem(LAST_TAB) || 'whiteForm'; }
function setLastNewType(t) { localStorage.setItem(LAST_NEW_TYPE, t); }
function getLastNewType() { return localStorage.getItem(LAST_NEW_TYPE) || 'white'; }

// ====== Tabs & Theme (2, 11) ======
$$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
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

const themeBtn = $('#toggleTheme');
function refreshThemeButton() {
    const mode = getTheme();
    themeBtn.textContent = mode === 'dark' ? '☀️' : '🌙';
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
const searchEl = $('#search');          // logs-local search
const globalSearchEl = $('#globalSearch'); // topbar global search
const chipsEl = $('#typeChips');
let entries = loadEntries();
let currentDetailId = null;

// ====== Helpers tied to fields ======
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

// ====== Forms to JSON (unchanged logic, with corrected labels kept in HTML) ======
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
    if (type === 'white') {
        entry.smell_fresh = getCheckedValues($$('input[name="smell_fresh"]', form));
    } else {
        entry.smell_fruit_red = getCheckedValues($$('input[name="smell_fruit_red"]', form));
    }
    entry.smell_other = getCheckedValues($$('input[name="smell_other"]', form));
    entry.smell_other_text = (fd.get('smell_other_text') || '').toString();

    // PALATE basics
    entry.sweetness = fd.get('sweetness') || '';
    entry.sourness = fd.get('sourness') || '';
    entry.bitterness = fd.get('bitterness') || '';
    entry.astringency = fd.get('astringency') || '';

    // PALATE descriptors
    if (type === 'white') {
        entry.palate_fresh = getCheckedValues($$('input[name="palate_fresh"]', form));
    } else {
        entry.palate_fruit_red = getCheckedValues($$('input[name="palate_fruit_red"]', form));
    }
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
function shortMeta(e) {
    const hue = e.hue || '-';
    const finish = e.finish || '-';
    return `${hue} • ${finish}`;
}

function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const activeChip = $('.chip.selected', chipsEl);
    const ft = activeChip ? activeChip.dataset.type : '';

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
            const title = document.createElement('div'); title.className = 'title'; title.textContent = e.name || '(no name)';
            const meta = document.createElement('div'); meta.className = 'meta';
            const dt = new Date(e.date).toLocaleString();
            meta.textContent = `${e.type.toUpperCase()} • ${shortMeta(e)} • ${dt}`;
            left.appendChild(title); left.appendChild(meta);

            const right = document.createElement('div');
            right.className = 'row-actions';
            const btnOpen = document.createElement('button'); btnOpen.className = 'iconbtn'; btnOpen.title = 'Open detail'; btnOpen.textContent = '⤢';
            const btnEdit = document.createElement('button'); btnEdit.className = 'iconbtn'; btnEdit.title = 'Edit'; btnEdit.textContent = '✎';
            const btnDelete = document.createElement('button'); btnDelete.className = 'iconbtn'; btnDelete.title = 'Delete'; btnDelete.textContent = '🗑';
            const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '›';
            right.appendChild(btnOpen); right.appendChild(btnEdit); right.appendChild(btnDelete); right.appendChild(chev);

            row.appendChild(left); row.appendChild(right);

            // Inline expand preview
            const expand = document.createElement('div');
            expand.className = 'row-expand';
            expand.innerHTML = buildPreviewHTML(e);

            // Events
            row.addEventListener('click', (ev) => {
                // avoid toggling when clicking action buttons
                if (ev.target === btnOpen || ev.target === btnEdit || ev.target === btnDelete) return;
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
                    renderList(); updateTabCounts();
                }
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
    renderList(); updateTabCounts();
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

    // stash id for overwrite on submit
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
    const data = await collectForm(form, 'white');
    if (editingId) {
        data.id = editingId;
        const idx = entries.findIndex(e => e.id === editingId);
        if (idx >= 0) entries[idx] = data;
        form.dataset.editId = '';
    } else {
        entries.push(data);
    }
    saveEntries(entries);
    form.reset();
    renderList(); updateTabCounts();
    switchTo('logsView');
});

$('#formRed').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const editingId = form.dataset.editId;
    const data = await collectForm(form, 'red');
    if (editingId) {
        data.id = editingId;
        const idx = entries.findIndex(e => e.id === editingId);
        if (idx >= 0) entries[idx] = data;
        form.dataset.editId = '';
    } else {
        entries.push(data);
    }
    saveEntries(entries);
    form.reset();
    renderList(); updateTabCounts();
    switchTo('logsView');
});

function switchTo(id) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === id));
    setLastTab(id);
}

// ====== Search / Filter / Clear ======
searchEl.addEventListener('input', renderList);

// chips: type filter (4)
chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $$('.chip', chipsEl).forEach(c => c.classList.remove('selected'));
    btn.classList.add('selected');
    renderList();
});

// topbar global search (3)
globalSearchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        // push to Logs and apply query
        switchTo('logsView');
        searchEl.value = globalSearchEl.value.trim();
        renderList();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === '/') {
        e.preventDefault(); globalSearchEl.focus();
    }
});

$('#clearAll').addEventListener('click', () => {
    if (confirm('Delete ALL entries? This cannot be undone.')) {
        entries = [];
        saveEntries(entries);
        renderList(); updateTabCounts();
    }
});

// ====== Count badges (2) ======
function updateTabCounts() {
    const white = entries.filter(e => e.type === 'white').length;
    const red = entries.filter(e => e.type === 'red').length;
    $('#countWhite').textContent = white;
    $('#countRed').textContent = red;
    $('#countAll').textContent = entries.length;
}

// ====== Quick Add (8) ======
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
    if (!name) { alert('Please enter a name'); return; }

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
        photo: photoFile && photoFile.size ? await readFileAsDataURL(photoFile) : ''
    };

    entries.push(entry);
    saveEntries(entries);
    renderList(); updateTabCounts();
    quickAddDialog.close();

    // Jump user into full form for refinement
    setLastNewType(type);
    startEdit(entry.id);
});

// ====== New Entry split button (1, 11) ======
const newEntryMain = $('#newEntryMain');
const newEntryMenuBtn = $('#newEntryMenuBtn');
const newEntryMenu = $('#newEntryMenu');

function openMenu(open) {
    newEntryMenu.classList.toggle('open', open);
    newEntryMenuBtn.setAttribute('aria-expanded', String(open));
    newEntryMenu.setAttribute('aria-hidden', String(!open));
}

newEntryMain.addEventListener('click', () => {
    // open last used type form
    const t = getLastNewType();
    switchTo(t === 'white' ? 'whiteForm' : 'redForm');
});

newEntryMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !newEntryMenu.classList.contains('open');
    openMenu(willOpen);
});

newEntryMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.menuitem');
    if (!btn) return;
    const t = btn.dataset.newtype;
    setLastNewType(t);
    openMenu(false);
    switchTo(t === 'white' ? 'whiteForm' : 'redForm');
});
document.addEventListener('click', (e) => {
    if (!newEntryMenu.contains(e.target) && e.target !== newEntryMenuBtn) openMenu(false);
});

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

// ====== Utilities ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function updateTopbarHeight() {
    const tb = document.querySelector('.topbar');
    if (!tb) return;
    const h = tb.offsetHeight;
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
}
window.addEventListener('load', updateTopbarHeight);
window.addEventListener('resize', updateTopbarHeight);
window.addEventListener('orientationchange', updateTopbarHeight);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateTopbarHeight);
}
updateTopbarHeight();

// ====== Storage keys ======
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
const searchEl = $('#search');
const globalSearchEl = $('#globalSearch');
const chipsEl = $('#typeChips');

let entries = loadEntries();
let currentDetailId = null;

// ====== Migration: add like + public fields ======
entries = entries.map(e => ({
    likes: 0,
    liked: false,
    isPublic: false,
    ...e,
    likes: typeof e.likes === 'number' ? e.likes : 0,
    liked: typeof e.liked === 'boolean' ? e.liked : false,
    isPublic: typeof e.isPublic === 'boolean' ? e.isPublic : false
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
        appearance_clarity: fd.get('appearance_clarity') || '',
        hue_density: fd.get('hue_density') || '',
        hue: fd.get('hue') || '',
        smell_intensity: fd.get('smell_intensity') || '',
        smell_fresh: type === 'white' ? getCheckedValues($$('input[name="smell_fresh"]', form)) : [],
        smell_fruit_red: type === 'red' ? getCheckedValues($$('input[name="smell_fruit_red"]', form)) : [],
        smell_other: getCheckedValues($$('input[name="smell_other"]', form)),
        smell_other_text: (fd.get('smell_other_text') || '').toString(),
        sweetness: fd.get('sweetness') || '',
        sourness: fd.get('sourness') || '',
        bitterness: fd.get('bitterness') || '',
        astringency: fd.get('astringency') || '',
        palate_fresh: type === 'white' ? getCheckedValues($$('input[name="palate_fresh"]', form)) : [],
        palate_fruit_red: type === 'red' ? getCheckedValues($$('input[name="palate_fruit_red"]', form)) : [],
        palate_other: getCheckedValues($$('input[name="palate_other"]', form)),
        palate_other_text: (fd.get('palate_other_text') || '').toString(),
        body: fd.get('body') || '',
        texture: fd.get('texture') || '',
        balance: fd.get('balance') || '',
        finish: fd.get('finish') || '',
        photo: '',
        likes: 0,
        liked: false,
        isPublic: false
    };
    const photoFile = fd.get('photo');
    entry.photo = photoFile && photoFile.size ? await readFileAsDataURL(photoFile) : '';
    return entry;
}

// ====== Rendering ======
function shortMeta(e) {
    const take = (arr, n = 2) => (arr || []).filter(Boolean).slice(0, n);
    const nose = e.type === 'white'
        ? [...take(e.smell_fresh, 2), ...take(e.smell_other, 1)]
        : [...take(e.smell_fruit_red, 2), ...take(e.smell_other, 1)];
    if (e.smell_other_text) nose.push(e.smell_other_text);
    const palate = e.type === 'white'
        ? [...take(e.palate_fresh, 2), ...take(e.palate_other, 1)]
        : [...take(e.palate_fruit_red, 2), ...take(e.palate_other, 1)];
    if (e.palate_other_text) palate.push(e.palate_other_text);
    const noseStr = nose.filter(Boolean).slice(0, 3).join(', ') || '-';
    const palateStr = palate.filter(Boolean).slice(0, 3).join(', ') || '-';
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
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(e => {
        const li = document.createElement('li');
        const row = document.createElement('div'); row.className = 'row row-main';
        const left = document.createElement('div');
        const title = document.createElement('div'); title.className = 'title'; title.textContent = e.name || '(no name)';
        const meta = document.createElement('div'); meta.className = 'meta';
        const dt = new Date(e.date).toLocaleString();
        meta.textContent = `${e.type.toUpperCase()} • ${shortMeta(e)} • ${dt}`;
        left.appendChild(title); left.appendChild(meta);
        const right = document.createElement('div'); right.className = 'row-actions';

        const btnOpen = document.createElement('button'); btnOpen.className = 'iconbtn'; btnOpen.title = 'Open detail'; btnOpen.textContent = '📂';
        const btnEdit = document.createElement('button'); btnEdit.className = 'iconbtn'; btnEdit.title = 'Edit'; btnEdit.textContent = '✏️';
        const btnDelete = document.createElement('button'); btnDelete.className = 'iconbtn'; btnDelete.title = 'Delete'; btnDelete.textContent = '🗑';

        const btnPublish = document.createElement('button');
        btnPublish.className = 'iconbtn publish';
        btnPublish.title = 'Toggle public';
        btnPublish.setAttribute('aria-pressed', e.isPublic ? 'true' : 'false');
        btnPublish.textContent = '🌐';

        const btnLike = document.createElement('button');
        btnLike.className = 'iconbtn like';
        btnLike.title = 'Like';
        btnLike.setAttribute('aria-pressed', e.liked ? 'true' : 'false');
        btnLike.innerHTML = (e.liked ? '♥' : '♡') + `<span class="like-count">${e.likes || 0}</span>`;

        const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '›';

        right.append(btnOpen, btnEdit, btnDelete, btnPublish, btnLike, chev);
        row.append(left, right);

        const expand = document.createElement('div');
        expand.className = 'row-expand';
        expand.innerHTML = buildPreviewHTML(e);

        row.addEventListener('click', ev => {
            if ([btnOpen, btnEdit, btnDelete, btnLike, btnPublish].includes(ev.target) || btnLike.contains(ev.target)) return;
            li.classList.toggle('expanded');
            chev.textContent = li.classList.contains('expanded') ? '˅' : '›';
        });
        btnOpen.addEventListener('click', ev => { ev.stopPropagation(); openDetail(e.id); });
        btnEdit.addEventListener('click', ev => { ev.stopPropagation(); startEdit(e.id); });
        btnDelete.addEventListener('click', ev => {
            ev.stopPropagation();
            if (confirm('Delete this entry?')) {
                entries = entries.filter(x => x.id !== e.id);
                saveEntries(entries); renderList(); updateTabCounts();
            }
        });
        btnPublish.addEventListener('click', ev => {
            ev.stopPropagation();
            const idx = entries.findIndex(x => x.id === e.id);
            if (idx < 0) return;
            const next = !entries[idx].isPublic;
            entries[idx] = { ...entries[idx], isPublic: next };
            saveEntries(entries);
            btnPublish.setAttribute('aria-pressed', next ? 'true' : 'false');
        });
        btnLike.addEventListener('click', ev => {
            ev.stopPropagation();
            const idx = entries.findIndex(x => x.id === e.id); if (idx < 0) return;
            const curr = entries[idx]; const nextLiked = !curr.liked;
            const nextLikes = Math.max(0, (curr.likes || 0) + (nextLiked ? 1 : -1));
            entries[idx] = { ...curr, liked: nextLiked, likes: nextLikes };
            saveEntries(entries);
            btnLike.setAttribute('aria-pressed', nextLiked ? 'true' : 'false');
            btnLike.innerHTML = (nextLiked ? '♥' : '♡') + `<span class="like-count">${nextLikes}</span>`;
        });

        li.append(row, expand); listEl.appendChild(li);
    });
    updateTabCounts();
}

// ====== Public Tab ======
document.getElementById('exportPublic')?.addEventListener('click', () => {
    const pub = entries.filter(e => e.isPublic).map(e => ({ ...e, photo: '' }));
    const data = JSON.stringify(pub, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'public-logs.json';
    a.click();
    URL.revokeObjectURL(a.href);
});

async function loadPublicSnapshot() {
    const list = $('#publicList');
    if (!list) return;
    list.innerHTML = '<li class="row"><div class="meta">Loading…</div></li>';
    try {
        const res = await fetch('/data/public-logs.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        data.sort((a, b) => new Date(b.date) - new Date(a.date));
        list.innerHTML = '';
        for (const e of data) {
            const li = document.createElement('li');
            const row = document.createElement('div'); row.className = 'row';
            const title = document.createElement('div'); title.className = 'title'; title.textContent = e.name || '(no name)';
            const meta = document.createElement('div'); meta.className = 'meta';
            meta.textContent = `${(e.type || '').toUpperCase()} • ${shortMeta(e)} • ${new Date(e.date).toLocaleString()}`;
            row.append(title, meta); li.appendChild(row); list.appendChild(li);
        }
        if (!data.length) list.innerHTML = '<li class="row"><div class="meta">No public logs yet.</div></li>';
    } catch {
        list.innerHTML = '<li class="row"><div class="meta">Could not load /data/public-logs.json</div></li>';
    }
}

// ====== Rest of your functions (buildPreviewHTML, openDetail, submit handlers, etc.) stay the same ======
// (Keep all the rest of your code as-is, unchanged)

// At the bottom:
renderList();
updateTabCounts();

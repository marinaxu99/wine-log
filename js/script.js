// ====== Utilities ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEY = 'wineLog.entries.v1';
const THEME_KEY = 'wineLog.theme';

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

// ====== Tabs & Theme ======
$$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.tab;
        $$('.tabpanel').forEach(p => p.classList.remove('active'));
        $('#' + target).classList.add('active');
    });
});

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

// ====== Forms to JSON ======
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

async function collectForm(form, type) {
    const fd = new FormData(form);
    const entry = {
        id: uid(),
        type,                // 'white' | 'red'
        date: new Date().toISOString(),
        name: (fd.get('name') || '').toString().trim(),
        notes: (fd.get('notes') || '').toString(),
        // photo handled separately
    };

    // Shared fields (present in both, per your sheets)
    entry.appearance_clarity = fd.get('appearance_clarity') || '';
    entry.hue_density = fd.get('hue_density') || '';
    entry.hue = fd.get('hue') || '';
    entry.smell_intensity = fd.get('smell_intensity') || '';

    // Smell descriptors — differ in fruit list for red/white
    if (type === 'white') {
        entry.smell_fresh = getCheckedValues($$('input[name="smell_fresh"]', form));
    } else {
        entry.smell_fruit_red = getCheckedValues($$('input[name="smell_fruit_red"]', form));
    }
    entry.smell_other = getCheckedValues($$('input[name="smell_other"]', form));
    entry.smell_other_text = (fd.get('smell_other_text') || '').toString();

    // Palate basics
    entry.sweetness = fd.get('sweetness') || '';
    entry.sourness = fd.get('sourness') || '';
    entry.bitterness = fd.get('bitterness') || '';
    entry.astringency = fd.get('astringency') || '';

    // Palate descriptors — differ in fruit list for red/white
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

// ====== Render List & Detail ======
const listEl = $('#logList');
const searchEl = $('#search');
const filterTypeEl = $('#filterType');
let entries = loadEntries();
let currentDetailId = null;

function shortMeta(e) {
    // Show one or two universal categories after name -> we'll use hue + finish (shared by both)
    const hue = e.hue || '-';
    const finish = e.finish || '-';
    return `${hue} • ${finish}`;
}

function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const ft = filterTypeEl.value;

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
            const left = document.createElement('div');
            const right = document.createElement('div');

            const title = document.createElement('div');
            title.textContent = e.name || '(no name)';
            const meta = document.createElement('div');
            meta.className = 'meta';
            const dt = new Date(e.date).toLocaleString();
            meta.textContent = `${e.type.toUpperCase()} • ${shortMeta(e)} • ${dt}`;

            left.appendChild(title);
            left.appendChild(meta);

            right.innerHTML = '›';
            li.appendChild(left);
            li.appendChild(right);

            li.addEventListener('click', () => openDetail(e.id));
            listEl.appendChild(li);
        });
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
    html += kv('Apperance clarity', e.appearance_clarity);
    html += kv('hue density', e.hue_density);
    html += kv('hue', e.hue);
    html += kv('goose smell intensity', e.smell_intensity);

    if (e.type === 'white') {
        html += kv('smell descriptors: fresh fruit', e.smell_fresh);
    } else {
        html += kv('smell descriptors: fruit', e.smell_fruit_red);
    }
    html += kv('smell descriptors (other)', [...(e.smell_other || []), e.smell_other_text].filter(Boolean));

    html += kv('palate sweetness', e.sweetness);
    html += kv('sourness', e.sourness);
    html += kv('bitterness', e.bitterness);
    html += kv('astringency', e.astringency);

    if (e.type === 'white') {
        html += kv('palate/finish — fresh fruit', e.palate_fresh);
    } else {
        html += kv('palate/finish — fruit', e.palate_fruit_red);
    }
    html += kv('palate/finish (other)', [...(e.palate_other || []), e.palate_other_text].filter(Boolean));

    html += kv('body', e.body);
    html += kv('texture', e.texture);
    html += kv('balance', e.balance);
    html += kv('finish', e.finish);
    html += kv('Side notes', e.notes);
    html += `</div>`;

    if (e.photo) {
        html += `<img class="img-preview" src="${e.photo}" alt="photo" />`;
    }

    art.innerHTML = html;
    $('#detailDialog').showModal();
}
$('#closeDetail').addEventListener('click', () => $('#detailDialog').close());

$('#deleteEntry').addEventListener('click', () => {
    if (!currentDetailId) return;
    entries = entries.filter(e => e.id !== currentDetailId);
    saveEntries(entries);
    renderList();
    $('#detailDialog').close();
});
$('#editEntry').addEventListener('click', () => {
    if (!currentDetailId) return;
    const e = entries.find(x => x.id === currentDetailId);
    if (!e) return;
    // Load into corresponding form and switch tab
    const targetTab = e.type === 'white' ? 'whiteForm' : 'redForm';
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === targetTab));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === targetTab));
    fillForm(e);
    $('#detailDialog').close();
});

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
    form.smell_other_text && (form.smell_other_text.value = e.smell_other_text || '');

    setRadio(form, 'sweetness', e.sweetness);
    setRadio(form, 'sourness', e.sourness);
    setRadio(form, 'bitterness', e.bitterness);
    setRadio(form, 'astringency', e.astringency);

    if (e.type === 'white') setChecks(form, 'palate_fresh', e.palate_fresh || []);
    else setChecks(form, 'palate_fruit_red', e.palate_fruit_red || []);

    setChecks(form, 'palate_other', e.palate_other || []);
    form.palate_other_text && (form.palate_other_text.value = e.palate_other_text || '');

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
    renderList();
    // Switch to logs after save
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
    renderList();
    switchTo('logsView');
});

function switchTo(id) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === id));
}

// ====== Search / Filter / Clear ======
searchEl.addEventListener('input', renderList);
filterTypeEl.addEventListener('change', renderList);
$('#clearAll').addEventListener('click', () => {
    if (confirm('Delete ALL entries? This cannot be undone.')) {
        entries = [];
        saveEntries(entries);
        renderList();
    }
});

// ====== Export / Import ======
function toCSV(rows) {
    // Flatten arrays; include a consistent column set
    const cols = [
        'id', 'type', 'date', 'name', 'appearance_clarity', 'hue_density', 'hue', 'smell_intensity',
        'smell_fresh', 'smell_fruit_red', 'smell_other', 'smell_other_text',
        'sweetness', 'sourness', 'bitterness', 'astringency',
        'palate_fresh', 'palate_fruit_red', 'palate_other', 'palate_other_text',
        'body', 'texture', 'balance', 'finish', 'notes'
    ];
    const esc = (v) => {
        if (v == null) return '';
        if (Array.isArray(v)) v = v.join('; ');
        v = String(v);
        if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
        return v;
    };
    const head = cols.join(',');
    const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
    return head + '\n' + body;
}
function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}
$('#exportCSV').addEventListener('click', () => {
    const csv = toCSV(entries);
    download('wine_logs.csv', csv, 'text/csv');
});
$('#exportJSON').addEventListener('click', () => {
    download('wine_logs.json', JSON.stringify(entries, null, 2), 'application/json');
});
$('#importJSON').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('Invalid JSON');
        // Merge by id (overwrite duplicates)
        const byId = new Map(entries.map(e => [e.id, e]));
        data.forEach(d => byId.set(d.id || uid(), d));
        entries = Array.from(byId.values());
        saveEntries(entries);
        renderList();
        alert('Import complete.');
    } catch (e) {
        alert('Invalid JSON file.');
    } finally {
        ev.target.value = '';
    }
});

// ====== Init ======
renderList();

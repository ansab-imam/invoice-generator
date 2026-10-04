(function () {
  'use strict';

  const DRAFT_KEY = 'invoice-generator:draft';
  const LOGO_KEY = 'invoice-generator:logo';
  const LAST_NUMBER_KEY = 'invoice-generator:last-number';
  const LOGO_PERSIST_LIMIT = 200 * 1024;
  const CURRENCIES = ['USD', 'GBP', 'EUR', 'PKR', 'INR', 'AED', 'AUD', 'CAD'];

  const $ = (id) => document.getElementById(id);
  const itemsList = $('items');
  const itemTemplate = $('item-template');

  let state = blankInvoice();
  let logo = '';
  let saveTimer = 0;

  /* ---------- storage (every access guarded: private mode or full quota must not break the app) ---------- */

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- dates and numbers ---------- */

  function isoDate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return isoDate(new Date(y, m - 1, d + days));
  }

  function formatDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatMoney(value, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(value);
    } catch (e) {
      return currency + ' ' + value.toFixed(2);
    }
  }

  // Increments the trailing digits and keeps any prefix and zero padding: INV-0099 -> INV-0100.
  function nextNumber(previous) {
    if (!previous) return 'INV-0001';
    const match = /^(.*?)(\d+)(\D*)$/.exec(previous);
    if (!match) return previous + '-2';
    const next = String(Number(match[2]) + 1).padStart(match[2].length, '0');
    return match[1] + next + match[3];
  }

  function rememberNumber(number) {
    if (number) storageSet(LAST_NUMBER_KEY, number);
  }

  /* ---------- state ---------- */

  function blankItem() {
    return { description: '', quantity: '1', unitPrice: '', taxRate: '' };
  }

  function blankInvoice() {
    const today = isoDate(new Date());
    return {
      number: nextNumber(storageGet(LAST_NUMBER_KEY)),
      issueDate: today,
      dueDate: addDays(today, 14),
      currency: 'USD',
      from: { name: '', email: '', address: '' },
      to: { name: '', email: '', address: '' },
      items: [blankItem()],
      discount: { type: 'percent', value: '' },
      shipping: '',
      notes: '',
      bank: ''
    };
  }

  function sampleInvoice() {
    const today = isoDate(new Date());
    return {
      number: 'SF-2026-0042',
      issueDate: today,
      dueDate: addDays(today, 30),
      currency: 'GBP',
      from: {
        name: 'Socialist Fox',
        email: 'billing@example.com',
        address: '12 Example Street\nSpringfield\nSP1 2AB'
      },
      to: {
        name: 'Northwind Studio Ltd',
        email: 'accounts@example.com',
        address: '48 Sample Avenue\nShelbyville\nSH4 7CD'
      },
      items: [
        { description: 'Website redesign — discovery and wireframes', quantity: '1', unitPrice: '1200', taxRate: '20' },
        { description: 'Front-end development (hours)', quantity: '24', unitPrice: '65', taxRate: '20' },
        { description: 'Stock photography licence', quantity: '3', unitPrice: '19.99', taxRate: '0' }
      ],
      discount: { type: 'percent', value: '5' },
      shipping: '',
      notes: 'Thank you for your business. Payment due within 30 days.\nPlease quote the invoice number with your payment.',
      bank: 'Account name: Socialist Fox\nSort code: 00-00-00\nAccount no.: 00000000\n(Example details — replace with your own.)'
    };
  }

  // Imported or stored JSON is untrusted: coerce every field to the shape the app expects.
  function normalise(raw) {
    const base = blankInvoice();
    if (!raw || typeof raw !== 'object') return base;
    const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    const party = (p) => ({ name: str(p && p.name), email: str(p && p.email), address: str(p && p.address) });
    const items = Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i === 'object').map((i) => ({
      description: str(i.description),
      quantity: str(i.quantity),
      unitPrice: str(i.unitPrice),
      taxRate: str(i.taxRate)
    })) : [];
    return {
      number: str(raw.number) || base.number,
      issueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.issueDate) ? raw.issueDate : base.issueDate,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : '',
      currency: CURRENCIES.includes(raw.currency) ? raw.currency : base.currency,
      from: party(raw.from),
      to: party(raw.to),
      items: items.length ? items : [blankItem()],
      discount: {
        type: raw.discount && raw.discount.type === 'fixed' ? 'fixed' : 'percent',
        value: str(raw.discount && raw.discount.value)
      },
      shipping: str(raw.shipping),
      notes: str(raw.notes),
      bank: str(raw.bank)
    };
  }

  /* ---------- status messages ---------- */

  let statusTimer = 0;
  function announce(message, persist) {
    const el = $('status');
    el.textContent = message;
    clearTimeout(statusTimer);
    if (!persist) statusTimer = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  /* ---------- editor <-> state ---------- */

  const simpleFields = {
    number: 'number', issueDate: 'issueDate', dueDate: 'dueDate', currency: 'currency',
    shipping: 'shipping', notes: 'notes', bank: 'bank'
  };
  const partyFields = ['name', 'email', 'address'];

  function fillEditor() {
    Object.keys(simpleFields).forEach((key) => { $(simpleFields[key]).value = state[key]; });
    partyFields.forEach((f) => {
      $('from-' + f).value = state.from[f];
      $('to-' + f).value = state.to[f];
    });
    $('discount-type').value = state.discount.type;
    $('discount-value').value = state.discount.value;
    renderItemsEditor();
  }

  function renderItemsEditor(focusIndex, focusAction) {
    itemsList.textContent = '';
    state.items.forEach((item, index) => {
      const node = itemTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.index = index;
      node.setAttribute('aria-label', 'Line ' + (index + 1));
      node.querySelectorAll('[data-field]').forEach((input) => { input.value = item[input.dataset.field]; });
      node.querySelector('[data-action="up"]').disabled = index === 0;
      node.querySelector('[data-action="down"]').disabled = index === state.items.length - 1;
      itemsList.appendChild(node);
    });
    if (focusIndex !== undefined) {
      const row = itemsList.children[Math.min(focusIndex, state.items.length - 1)];
      if (!row) return;
      const target = row.querySelector('[data-action="' + focusAction + '"]:not(:disabled)') || row.querySelector('input');
      target.focus();
    }
  }

  function onEditorInput(event) {
    const target = event.target;
    const row = target.closest('.item');
    if (row && target.dataset.field) {
      state.items[Number(row.dataset.index)][target.dataset.field] = target.value;
    } else if (target.id === 'discount-type') {
      state.discount.type = target.value;
    } else if (target.id === 'discount-value') {
      state.discount.value = target.value;
    } else if (/^(from|to)-/.test(target.id)) {
      const [party, field] = target.id.split('-');
      state[party][field] = target.value;
    } else {
      const key = Object.keys(simpleFields).find((k) => simpleFields[k] === target.id);
      if (!key) return;
      state[key] = target.value;
    }
    update();
  }

  function onItemAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const index = Number(button.closest('.item').dataset.index);
    const action = button.dataset.action;
    const items = state.items;

    if (action === 'remove') {
      items.splice(index, 1);
      if (!items.length) items.push(blankItem());
      renderItemsEditor(Math.max(0, index - 1), 'remove');
      announce('Line removed.');
    } else {
      const to = action === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= items.length) return;
      [items[index], items[to]] = [items[to], items[index]];
      renderItemsEditor(to, action);
    }
    update();
  }

  /* ---------- preview ---------- */

  function setText(id, text, fallback) {
    $(id).textContent = text || fallback || '';
  }

  function renderPreview() {
    const totals = window.InvoiceMath.calculateTotals(state);
    const money = (v) => formatMoney(v, state.currency);

    const img = $('p-logo');
    img.hidden = !logo;
    if (logo) img.src = logo; else img.removeAttribute('src');
    img.alt = logo ? (state.from.name || 'Company') + ' logo' : '';

    setText('p-from-name', state.from.name, 'Your business name');
    setText('p-from-address', state.from.address);
    setText('p-from-email', state.from.email);
    setText('p-to-name', state.to.name, 'Client name');
    setText('p-to-address', state.to.address);
    setText('p-to-email', state.to.email);
    setText('p-number', state.number, '—');
    setText('p-issue', formatDate(state.issueDate));
    setText('p-due', formatDate(state.dueDate));

    const body = $('p-items');
    body.textContent = '';
    let shown = 0;
    state.items.forEach((item, i) => {
      const line = totals.lines[i];
      if (!item.description.trim() && line.amount === 0) return;
      shown++;
      const tr = document.createElement('tr');
      const cells = [
        [item.description || '—', ''],
        [String(window.InvoiceMath.toNumber(item.quantity)), 'num'],
        [money(window.InvoiceMath.toNumber(item.unitPrice)), 'num'],
        [line.taxRate ? line.taxRate + '%' : '—', 'num'],
        [money(line.amount), 'num']
      ];
      cells.forEach(([text, cls]) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (!shown) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty';
      td.textContent = 'No line items yet';
      tr.appendChild(td);
      body.appendChild(tr);
    }

    const rows = [['Subtotal', money(totals.subtotal)]];
    if (totals.discount > 0) {
      const label = state.discount.type === 'percent'
        ? 'Discount (' + window.InvoiceMath.toNumber(state.discount.value) + '%)'
        : 'Discount';
      rows.push([label, '−' + money(totals.discount)]);
    }
    if (totals.tax > 0) rows.push(['Tax', money(totals.tax)]);
    if (totals.shipping > 0) rows.push(['Shipping', money(totals.shipping)]);
    rows.push(['Total due', money(totals.total), 'grand']);

    const dl = $('p-totals');
    dl.textContent = '';
    rows.forEach(([label, value, cls]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      if (cls) { dt.className = cls; dd.className = cls; }
      dl.append(dt, dd);
    });

    setText('p-notes', state.notes);
    setText('p-bank', state.bank);
    $('p-notes-wrap').hidden = !state.notes.trim();
    $('p-bank-wrap').hidden = !state.bank.trim();

    document.title = state.number ? 'Invoice ' + state.number : 'Invoice Generator';
  }

  /* ---------- persistence ---------- */

  function saveDraft() {
    if (!storageSet(DRAFT_KEY, JSON.stringify(state))) {
      announce('Could not autosave — browser storage is unavailable or full.', true);
    }
  }

  function update() {
    renderPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }

  function loadDraft() {
    const raw = storageGet(DRAFT_KEY);
    if (!raw) return null;
    try { return normalise(JSON.parse(raw)); } catch (e) { return null; }
  }

  function replaceState(next) {
    state = next;
    fillEditor();
    update();
  }

  /* ---------- logo ---------- */

  function setLogo(dataUrl, persist) {
    logo = dataUrl;
    $('logo-remove').hidden = !logo;
    if (!logo) storageRemove(LOGO_KEY);
    else if (persist) persist = storageSet(LOGO_KEY, logo);
    renderPreview();
    return persist;
  }

  function onLogoChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      announce('Please choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Data URLs are ~33% larger than the file; compare the stored size, not the file size.
      const small = reader.result.length <= LOGO_PERSIST_LIMIT;
      if (!small) storageRemove(LOGO_KEY);
      const saved = setLogo(reader.result, small);
      announce(saved
        ? 'Logo added and saved on this device.'
        : 'Logo added for this session only — it is too large to remember (limit about 200 KB).', !saved);
    };
    reader.onerror = () => announce('Could not read that image.');
    reader.readAsDataURL(file);
  }

  /* ---------- import / export / print ---------- */

  function exportJson() {
    const data = Object.assign({ format: 'invoice-generator', version: 1 }, state);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice-' + (state.number || 'draft').replace(/[^\w.-]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    rememberNumber(state.number);
    announce('Invoice exported.');
  }

  function importJson(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) throw new Error('shape');
      replaceState(normalise(parsed));
      announce('Imported ' + file.name + '.');
    }).catch(() => announce('That file is not a valid invoice JSON export.'));
  }

  function printInvoice() {
    rememberNumber(state.number);
    window.print();
  }

  /* ---------- wiring ---------- */

  const editor = $('editor');
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('change', onEditorInput);
  editor.addEventListener('submit', (e) => e.preventDefault());
  itemsList.addEventListener('click', onItemAction);

  $('add-item').addEventListener('click', () => {
    state.items.push(blankItem());
    renderItemsEditor(state.items.length - 1, 'none');
    update();
  });

  document.querySelectorAll('[data-net]').forEach((button) => {
    button.addEventListener('click', () => {
      const from = state.issueDate || isoDate(new Date());
      state.dueDate = addDays(from, Number(button.dataset.net));
      $('dueDate').value = state.dueDate;
      update();
      announce('Due date set to ' + formatDate(state.dueDate) + '.');
    });
  });

  $('logo-input').addEventListener('change', onLogoChosen);
  $('logo-remove').addEventListener('click', () => {
    setLogo('', false);
    $('logo-input').value = '';
    announce('Logo removed.');
  });

  $('print-btn').addEventListener('click', printInvoice);
  $('export-btn').addEventListener('click', exportJson);
  $('import-input').addEventListener('change', importJson);

  $('sample-btn').addEventListener('click', () => {
    if (!confirm('Replace the current invoice with sample data?')) return;
    replaceState(sampleInvoice());
    announce('Sample invoice loaded.');
  });

  $('new-btn').addEventListener('click', () => {
    if (!confirm('Start a new invoice? Unsaved changes to this one will be lost.')) return;
    rememberNumber(state.number);
    replaceState(blankInvoice());
    announce('New invoice started.');
  });

  /* ---------- start ---------- */

  const storedLogo = storageGet(LOGO_KEY);
  if (storedLogo) setLogo(storedLogo, false);
  state = loadDraft() || blankInvoice();
  fillEditor();
  renderPreview();
})();

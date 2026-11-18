/**
 * The support panel at /admin: one HTML page and one script, served by the API itself.
 * No build step and no framework: list of applications → open one → «Одобрить» / «Отклонить».
 */
export const ADMIN_PAGE_HTML = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>UzBite — проверка курьеров</title>
<style>
:root { --bg: #f5f5f2; --surface: #fff; --ink: #242521; --muted: #6b6c66; --line: #e2e2db; --accent: #f8781d; --ok: #1f8a4c; --bad: #c93c3c; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0 0 4px; font-size: 26px; }
.muted { color: var(--muted); }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.tabs button { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 8px 14px; font: inherit; cursor: pointer; }
.tabs button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-bottom: 12px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.card h3 { margin: 0 0 4px; font-size: 17px; }
.photo { width: 72px; height: 90px; border-radius: 10px; object-fit: cover; background: #ecece6; flex: none; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 12px; }
.photo.big { width: 240px; height: 300px; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #eee; margin-top: 6px; }
.PENDING { background: #fff1e6; color: #b9530a; } .APPROVED { background: #e7f6ec; color: var(--ok); } .REJECTED, .SUSPENDED { background: #fdecec; color: var(--bad); }
.btn { border: 0; border-radius: 12px; padding: 12px 22px; font: 600 15px system-ui, sans-serif; cursor: pointer; }
.approve { background: var(--ok); color: #fff; } .reject { background: var(--bad); color: #fff; } .open { background: var(--ink); color: #fff; } .back { background: transparent; color: var(--ink); padding-left: 0; }
.btn:disabled { opacity: .5; cursor: default; }
.detail { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: flex; gap: 24px; flex-wrap: wrap; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 12px 0 16px; }
dt { color: var(--muted); } dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
textarea, input { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 10px; font: inherit; }
textarea { min-height: 70px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.error { color: var(--bad); }
</style></head>
<body><main id="app"><p class="muted">Загрузка…</p></main><script src="/admin/app.js"></script></body></html>`;

export const ADMIN_PAGE_JS = String.raw`(function () {
  var app = document.getElementById('app');
  var LABEL = { PENDING: 'Ожидает проверки', APPROVED: 'Одобрен', REJECTED: 'Отклонён', SUSPENDED: 'Заблокирован' };
  var key = ''; try { key = localStorage.getItem('uzbiteAdminKey') || ''; } catch (e) {}
  var filter = 'PENDING';
  function headers() { var h = { 'Content-Type': 'application/json' }; if (key) h['X-Admin-Key'] = key; return h; }
  function api(path, options) {
    options = options || {};
    return fetch('/api/admin' + path, { method: options.method || 'GET', headers: headers(), body: options.body ? JSON.stringify(options.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error((b.error && b.error.message) || ('Ошибка ' + r.status)); return b.data; }); });
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'onclick') n.onclick = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function fullName(c) { return ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || 'Без имени'; }
  function passport(c) { return c.passportSeries && c.passportNumber ? c.passportSeries + ' ' + c.passportNumber : 'не указан'; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('ru-RU') : '—'; }
  function badge(status) { return el('span', { 'class': 'badge ' + status, text: status + ' — ' + LABEL[status] }); }
  function photo(c, big) {
    var cls = 'photo' + (big ? ' big' : '');
    if (!c.hasFacePhoto) return el('div', { 'class': cls, text: 'нет фото' });
    var img = el('img', { 'class': cls, alt: 'Фото лица' });
    fetch('/api/admin/couriers/' + c.id + '/face-photo', { headers: key ? { 'X-Admin-Key': key } : {} })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (blob) { if (!blob) return; var reader = new FileReader(); reader.onload = function () { img.src = reader.result; }; reader.readAsDataURL(blob); });
    return img;
  }
  function showError(error) {
    var input = el('input', { placeholder: 'Ключ поддержки (X-Admin-Key)', value: key });
    app.replaceChildren(el('h1', { text: 'Курьеры' }), el('p', { 'class': 'error', text: error.message }),
      el('div', { 'class': 'row' }, [input, el('button', { 'class': 'btn open', text: 'Сохранить ключ', onclick: function () { key = input.value.trim(); try { localStorage.setItem('uzbiteAdminKey', key); } catch (e) {} route(); } })]));
  }
  function list() {
    api('/couriers?status=' + filter).then(function (data) {
      var total = Object.keys(data.counts).reduce(function (sum, k) { return sum + data.counts[k]; }, 0);
      var tabs = el('div', { 'class': 'tabs' }, ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'].map(function (s) {
        return el('button', { 'class': s === filter ? 'on' : '', text: (s === 'ALL' ? 'Все' : LABEL[s]) + ': ' + (s === 'ALL' ? total : data.counts[s]), onclick: function () { filter = s; list(); } });
      }));
      var cards = data.items.length ? data.items.map(function (c) {
        return el('div', { 'class': 'card' }, [photo(c, false),
          el('div', { style: 'flex:1;min-width:200px' }, [el('h3', { text: fullName(c) }), el('div', { text: 'Паспорт: ' + passport(c) }), el('div', { 'class': 'muted', text: 'Заявка: ' + when(c.submittedAt) }), badge(c.status)]),
          el('button', { 'class': 'btn open', text: 'Открыть', onclick: function () { location.hash = c.id; } })]);
      }) : [el('p', { 'class': 'muted', text: 'В этом списке никого нет.' })];
      app.replaceChildren.apply(app, [el('h1', { text: 'Курьеры' }), el('p', { 'class': 'muted', text: 'Ожидают проверки: ' + data.counts.PENDING }), tabs].concat(cards));
    }).catch(showError);
  }
  function detail(id) {
    api('/couriers/' + encodeURIComponent(id)).then(function (c) {
      var reason = el('textarea', { placeholder: 'Причина отказа — курьер её увидит (необязательно)', maxlength: '500' });
      var error = el('p', { 'class': 'error' });
      var buttons = [];
      function decide(action) {
        buttons.forEach(function (b) { b.disabled = true; });
        api('/couriers/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: action === 'reject' ? { reason: reason.value.trim() || undefined } : {} })
          .then(function () { detail(id); })
          .catch(function (e) { error.textContent = e.message; buttons.forEach(function (b) { b.disabled = false; }); });
      }
      buttons = [el('button', { 'class': 'btn approve', text: 'Одобрить', onclick: function () { decide('approve'); } }), el('button', { 'class': 'btn reject', text: 'Отклонить', onclick: function () { decide('reject'); } })];
      var rows = [['Имя', c.firstName || '—'], ['Фамилия', c.lastName || '—'], ['Серия паспорта', c.passportSeries || '—'], ['Номер паспорта', c.passportNumber || '—'],
        ['Телефон', c.phone || '—'], ['Почта', c.email || '—'], ['Режим', c.workMode === 'RESTAURANT' ? 'Свой ресторан' : c.workMode === 'FREELANCE' ? 'Свободные доставки' : '—'],
        ['Город', c.city || '—'], ['Дата заявки', when(c.submittedAt)], ['Статус изменён', when(c.statusChangedAt)]];
      if (c.rejectionReason) rows.push(['Причина отказа', c.rejectionReason]);
      var info = el('dl', {}, rows.reduce(function (out, p) { return out.concat([el('dt', { text: p[0] }), el('dd', { text: p[1] })]); }, []));
      app.replaceChildren(el('button', { 'class': 'btn back', text: '← К списку', onclick: function () { location.hash = ''; } }), el('h1', { text: fullName(c) }),
        el('div', { 'class': 'detail' }, [photo(c, true), el('div', { style: 'flex:1;min-width:260px' }, [badge(c.status), info, reason, el('div', { 'class': 'row' }, buttons), error])]));
    }).catch(showError);
  }
  function route() { var id = location.hash.slice(1); if (id) detail(id); else list(); }
  window.addEventListener('hashchange', route);
  route();
})();`;

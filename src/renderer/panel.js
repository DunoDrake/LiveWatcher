'use strict';

const dom = {
  count: document.getElementById('count'),
  banner: document.getElementById('banner'),
  devList: document.getElementById('dev-list'),
  otherList: document.getElementById('other-list'),
  otherToggle: document.getElementById('other-toggle'),
  otherLabel: document.getElementById('other-label'),
  chevron: document.getElementById('chevron'),
  empty: document.getElementById('empty'),
  refresh: document.getElementById('refresh'),
  login: document.getElementById('login'),
  quit: document.getElementById('quit')
};

let otherOpen = false;

function formatUptime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function dotClass(entry) {
  if (entry.kind !== 'http') return 'warn';
  return entry.httpStatus >= 200 && entry.httpStatus < 400 ? 'live' : 'warn';
}

function metaLine(entry) {
  const parts = [];
  if (entry.title) parts.push(entry.title);
  if (entry.framework) parts.push(entry.framework);
  parts.push(`${entry.processName} (pid ${entry.pid})`);
  return parts.join(' · ');
}

function actionButton({ label, title, className, onClick }) {
  const button = document.createElement('button');
  button.className = `icon-button ${className}`;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function buildRow(entry, now) {
  const row = document.createElement('li');
  row.className = 'row';

  const dot = document.createElement('span');
  dot.className = `dot ${dotClass(entry)}`;

  const middle = document.createElement('div');
  const addr = document.createElement('div');
  addr.className = 'addr';
  addr.textContent = `localhost:${entry.port}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaLine(entry);
  middle.append(addr, meta);

  const right = document.createElement('div');
  right.className = 'right';
  const uptime = document.createElement('span');
  uptime.className = 'uptime';
  uptime.textContent = entry.kind === 'http' ? formatUptime(now - entry.firstSeenAt) : '—';

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    actionButton({
      label: '↗',
      title: 'Open in browser',
      className: 'open',
      onClick: () => window.liveWatcher.openPort(entry.port)
    }),
    actionButton({
      label: '⧉',
      title: 'Copy URL',
      className: 'copy',
      onClick: () => window.liveWatcher.copyUrl(entry.port)
    }),
    actionButton({
      label: '■',
      title: 'Stop server',
      className: 'stop',
      onClick: async () => {
        const result = await window.liveWatcher.stopServer({
          pid: entry.pid,
          port: entry.port,
          processName: entry.processName
        });
        if (!result.ok && result.reason) showBanner(result.reason);
      }
    })
  );

  right.append(uptime, actions);
  row.append(dot, middle, right);
  row.addEventListener('dblclick', () => window.liveWatcher.openPort(entry.port));

  return row;
}

function showBanner(message) {
  dom.banner.textContent = message;
  dom.banner.hidden = false;
}

function render({ dev, other, error, settings, now }) {
  dom.banner.hidden = !error;
  if (error) dom.banner.textContent = error;

  dom.count.textContent = dev.length === 1 ? '1 live' : `${dev.length} live`;
  dom.empty.hidden = dev.length > 0;

  dom.devList.replaceChildren(...dev.map((entry) => buildRow(entry, now)));
  dom.otherList.replaceChildren(...other.map((entry) => buildRow(entry, now)));
  dom.otherLabel.textContent = `Other listening ports (${other.length})`;
  dom.login.checked = Boolean(settings.openAtLogin);
}

dom.otherToggle.addEventListener('click', () => {
  otherOpen = !otherOpen;
  dom.otherList.hidden = !otherOpen;
  dom.chevron.classList.toggle('open', otherOpen);
  dom.otherToggle.setAttribute('aria-expanded', String(otherOpen));
});

dom.refresh.addEventListener('click', () => window.liveWatcher.refresh());
dom.quit.addEventListener('click', () => window.liveWatcher.quit());
dom.login.addEventListener('change', () => {
  window.liveWatcher.setSetting('openAtLogin', dom.login.checked);
});

window.liveWatcher.onSnapshot(render);

'use strict';

const path = require('node:path');
const { Tray, BrowserWindow, nativeImage, screen, Menu } = require('electron');

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 620;
// electron loads the @2x variant itself when a HiDPI display asks for it, as
// long as both files sit in the same directory under this exact naming.
const TRAY_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png');

function createPanel() {
  const panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_MAX_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1c1b19',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  panel.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // The default application menu still offers Close Window (Cmd+W). Destroying
  // the only window would leave the tray icon alive but inert, with every later
  // click throwing on the destroyed object and no way back except Force Quit.
  panel.on('close', (event) => {
    event.preventDefault();
    panel.hide();
  });

  return panel;
}

function positionPanel(panel, trayBounds) {
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { width } = panel.getBounds();

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  x = Math.max(display.workArea.x + 8, Math.min(x, display.workArea.x + display.workArea.width - width - 8));

  const y = process.platform === 'darwin'
    ? Math.round(trayBounds.y + trayBounds.height + 4)
    : Math.round(display.workArea.y + display.workArea.height - panel.getBounds().height - 8);

  panel.setPosition(x, y, false);
}

function createTray({ onVisibilityChange, onCheckForUpdates }) {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('LiveWatcher');

  const panel = createPanel();

  // A confirmation dialog steals focus from the panel, and hide-on-blur would
  // then tear the panel out from under its own dialog. The main process raises
  // this flag around any dialog it opens.
  let suppressHide = false;

  panel.on('blur', () => {
    if (!suppressHide) panel.hide();
  });

  const toggle = () => {
    if (panel.isVisible()) {
      panel.hide();
      return;
    }
    positionPanel(panel, tray.getBounds());
    panel.show();
    panel.focus();
  };

  tray.on('click', toggle);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Check for Updates...', click: onCheckForUpdates }
    ]);
    tray.popUpContextMenu(menu);
  });
  panel.on('show', () => onVisibilityChange(true));
  panel.on('hide', () => onVisibilityChange(false));

  return {
    tray,
    panel,
    toggle,
    setSuppressHide: (value) => {
      suppressHide = value;
    }
  };
}

module.exports = { createTray, positionPanel, PANEL_WIDTH };

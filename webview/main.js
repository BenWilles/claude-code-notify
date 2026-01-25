// @ts-check

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // State
  let config = null;
  let voices = [];
  let sounds = [];
  let isInstalled = false;

  // Pending data for synchronized loading
  let pendingConfig = null;
  let pendingVoices = null;
  let pendingSounds = null;

  // DOM Elements
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const installBtn = document.getElementById('installBtn');
  const enabledToggle = document.getElementById('enabledToggle');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const cooldownSlider = document.getElementById('cooldownSlider');
  const cooldownValue = document.getElementById('cooldownValue');
  const restartBtn = document.getElementById('restartBtn');

  // Auto-save debounce timer
  let saveTimeout = null;

  // Initialize
  function init() {
    setupEventListeners();
    requestInitialData();
  }

  function requestInitialData() {
    vscode.postMessage({ type: 'getStatus' });
    vscode.postMessage({ type: 'getConfig' });
    vscode.postMessage({ type: 'getVoices' });
    vscode.postMessage({ type: 'getSounds' });
  }

  function setupEventListeners() {
    // Install/Remove button
    installBtn.addEventListener('click', () => {
      if (isInstalled) {
        vscode.postMessage({ type: 'remove' });
      } else {
        vscode.postMessage({ type: 'install' });
      }
    });

    // Restart button
    restartBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'restartClaude' });
    });

    // Global settings with auto-save
    enabledToggle.addEventListener('change', debouncedSave);

    volumeSlider.addEventListener('input', (e) => {
      volumeValue.textContent = e.target.value + '%';
    });
    volumeSlider.addEventListener('change', debouncedSave);

    cooldownSlider.addEventListener('input', (e) => {
      cooldownValue.textContent = e.target.value + 's';
    });
    cooldownSlider.addEventListener('change', debouncedSave);

    // Notification cards
    document.querySelectorAll('.notification-card').forEach(card => {
      // Collapse toggle
      const collapseBtn = card.querySelector('.collapse-btn');
      const body = card.querySelector('.notification-body');
      const icon = card.querySelector('.collapse-icon');

      collapseBtn.addEventListener('click', () => {
        const isExpanded = collapseBtn.getAttribute('aria-expanded') === 'true';
        collapseBtn.setAttribute('aria-expanded', !isExpanded);
        body.classList.toggle('collapsed', isExpanded);
        icon.textContent = isExpanded ? '▶' : '▼';
      });

      // Test button
      const testBtn = card.querySelector('.test-btn');
      testBtn.addEventListener('click', () => {
        const notifConfig = getNotificationConfig(card);

        if (notifConfig.mode === 'talk') {
          vscode.postMessage({
            type: 'previewVoice',
            payload: {
              voice: notifConfig.voice,
              text: notifConfig.text
            }
          });
        } else {
          vscode.postMessage({
            type: 'previewSound',
            payload: { sound: notifConfig.sound }
          });
        }
      });

      // Mode switch
      const modeSelect = card.querySelector('.notif-mode');
      modeSelect.addEventListener('change', (e) => {
        updateModeVisibility(card, e.target.value);
        debouncedSave();
      });

      // Auto-save for all notification settings
      card.querySelector('.notif-enabled').addEventListener('change', debouncedSave);
      card.querySelector('.notif-voice').addEventListener('change', debouncedSave);
      card.querySelector('.notif-text').addEventListener('change', debouncedSave);
      card.querySelector('.notif-sound').addEventListener('change', debouncedSave);
    });

    // Message handler
    window.addEventListener('message', handleMessage);
  }

  function handleMessage(event) {
    const message = event.data;

    switch (message.type) {
      case 'status':
        updateStatus(message.payload.installed);
        // Show restart button only if just installed (not on initial load)
        if (message.payload.justInstalled) {
          restartBtn.style.display = 'block';
        }
        break;

      case 'config':
        pendingConfig = message.payload;
        tryApplyFullConfig();
        break;

      case 'voices':
        pendingVoices = message.payload;
        tryApplyFullConfig();
        break;

      case 'sounds':
        pendingSounds = message.payload;
        tryApplyFullConfig();
        break;

      case 'saved':
        if (!message.payload.success) {
          console.error('Save error:', message.payload.error);
        }
        // Don't show restart button on save - only on fresh install
        break;

      case 'error':
        console.error('Error:', message.payload.message);
        break;
    }
  }

  function updateStatus(installed) {
    isInstalled = installed;
    statusIndicator.className = 'status-indicator ' + (installed ? 'installed' : 'not-installed');
    statusText.textContent = installed ? 'Installed' : 'Not installed';
    installBtn.textContent = installed ? 'Remove' : 'Install';
    // Don't automatically show restart button here - it's controlled by justInstalled flag
  }

  // Apply config only when all data is loaded to prevent race conditions
  function tryApplyFullConfig() {
    if (pendingConfig && pendingVoices && pendingSounds) {
      // First populate dropdowns
      voices = pendingVoices;
      sounds = pendingSounds;
      populateVoiceDropdowns(voices);
      populateSoundDropdowns(sounds);

      // Then apply config (now dropdowns have options to select)
      config = pendingConfig;
      applyConfig(config);

      // Clear pending state
      pendingConfig = null;
      pendingVoices = null;
      pendingSounds = null;
    }
  }

  function applyConfig(cfg) {
    enabledToggle.checked = cfg.enabled;
    volumeSlider.value = cfg.volume;
    volumeValue.textContent = cfg.volume + '%';
    cooldownSlider.value = cfg.cooldown;
    cooldownValue.textContent = cfg.cooldown + 's';

    // Apply to notification cards
    const typeMap = {
      permission_prompt: 'Permission Required',
      idle_prompt: 'Task Complete',
      elicitation_dialog: 'Input Needed',
      auth_success: 'Auth Success'
    };

    Object.entries(cfg.notifications).forEach(([type, setting]) => {
      const card = document.querySelector(`.notification-card[data-type="${type}"]`);
      if (!card) return;

      card.querySelector('.notif-enabled').checked = setting.enabled;
      card.querySelector('.notif-mode').value = setting.mode;

      if (setting.voice) {
        card.querySelector('.notif-voice').value = setting.voice;
      }
      if (setting.text) {
        card.querySelector('.notif-text').value = setting.text;
      }
      if (setting.sound) {
        card.querySelector('.notif-sound').value = setting.sound;
      }

      updateModeVisibility(card, setting.mode);
    });
  }

  function populateVoiceDropdowns(voices) {
    document.querySelectorAll('.notif-voice').forEach(select => {
      const currentValue = select.value;
      select.innerHTML = '';

      voices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.locale})`;
        select.appendChild(option);
      });

      // Restore selection if valid
      if (currentValue && voices.some(v => v.name === currentValue)) {
        select.value = currentValue;
      }
    });
  }

  function populateSoundDropdowns(sounds) {
    document.querySelectorAll('.notif-sound').forEach(select => {
      const currentValue = select.value;
      select.innerHTML = '';

      sounds.forEach(sound => {
        const option = document.createElement('option');
        option.value = sound.name;
        option.textContent = sound.name;
        select.appendChild(option);
      });

      // Restore selection if valid
      if (currentValue && sounds.some(s => s.name === currentValue)) {
        select.value = currentValue;
      }
    });
  }

  function updateModeVisibility(card, mode) {
    const talkSettings = card.querySelector('.talk-settings');
    const soundSettings = card.querySelector('.sound-settings');

    if (mode === 'talk') {
      talkSettings.style.display = 'block';
      soundSettings.style.display = 'none';
    } else {
      talkSettings.style.display = 'none';
      soundSettings.style.display = 'block';
    }
  }

  function getNotificationConfig(card) {
    const mode = card.querySelector('.notif-mode').value;
    return {
      enabled: card.querySelector('.notif-enabled').checked,
      mode: mode,
      voice: card.querySelector('.notif-voice').value,
      text: card.querySelector('.notif-text').value,
      sound: card.querySelector('.notif-sound').value
    };
  }

  // Debounced save - waits 300ms after last change before saving
  function debouncedSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveConfig();
    }, 300);
  }

  function saveConfig() {
    const newConfig = {
      enabled: enabledToggle.checked,
      volume: parseInt(volumeSlider.value, 10),
      cooldown: parseInt(cooldownSlider.value, 10),
      notifications: {}
    };

    document.querySelectorAll('.notification-card').forEach(card => {
      const type = card.dataset.type;
      newConfig.notifications[type] = getNotificationConfig(card);
    });

    vscode.postMessage({
      type: 'saveConfig',
      payload: newConfig
    });
  }

  // Start
  init();
})();

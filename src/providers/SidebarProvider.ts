import * as vscode from 'vscode';
import { ConfigService } from '../services/ConfigService';
import { VoiceService } from '../services/VoiceService';
import { SoundService } from '../services/SoundService';
import { HookService } from '../services/HookService';
import { WebviewMessage, ExtensionMessage, NotificationType } from '../types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claude-notify.sidebar';

  private _view?: vscode.WebviewView;

  private readonly configService: ConfigService;
  private readonly voiceService: VoiceService;
  private readonly soundService: SoundService;
  private readonly hookService: HookService;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this.configService = new ConfigService();
    this.voiceService = new VoiceService();
    this.soundService = new SoundService();
    this.hookService = new HookService();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        console.log('Received message from webview:', message.type, message);
        await this.handleMessage(message);
      }
    );
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'getStatus':
          const installed = await this.hookService.isInstalled();
          this.sendMessage({ type: 'status', payload: { installed } });
          break;

        case 'getConfig':
          const config = await this.configService.load();
          this.sendMessage({ type: 'config', payload: config });
          break;

        case 'saveConfig':
          // Validate payload before saving to prevent inconsistent state
          const validatedConfig = this.hookService.validateConfig(message.payload);
          await this.configService.save(validatedConfig);
          // Regenerate script if installed
          if (await this.hookService.isInstalled()) {
            await this.hookService.regenerateScript(validatedConfig);
          }
          this.sendMessage({ type: 'saved', payload: { success: true } });
          break;

        case 'getVoices':
          const voices = await this.voiceService.getVoices();
          this.sendMessage({ type: 'voices', payload: voices });
          break;

        case 'getSounds':
          const sounds = await this.soundService.getSounds();
          this.sendMessage({ type: 'sounds', payload: sounds });
          break;

        case 'install':
          const configForInstall = await this.configService.load();
          await this.hookService.install(configForInstall);
          this.sendMessage({ type: 'status', payload: { installed: true, justInstalled: true } });
          vscode.window.showInformationMessage('Claude Notify hook installed successfully!');
          break;

        case 'remove':
          await this.hookService.remove();
          this.sendMessage({ type: 'status', payload: { installed: false } });
          vscode.window.showInformationMessage('Claude Notify hook removed.');
          break;

        case 'testNotification':
          await this.testNotification(message.payload.notificationType);
          break;

        case 'previewVoice':
          const currentConfig = await this.configService.load();
          await this.voiceService.preview(
            message.payload.voice,
            message.payload.text,
            currentConfig.volume
          );
          break;

        case 'previewSound':
          const configForSound = await this.configService.load();
          await this.soundService.preview(message.payload.sound, configForSound.volume);
          break;

        case 'restartClaude':
          // Reload the VS Code window to restart Claude Code with new hook settings
          vscode.commands.executeCommand('workbench.action.reloadWindow');
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({ type: 'error', payload: { message: errorMessage } });
      vscode.window.showErrorMessage(`Claude Notify: ${errorMessage}`);
    }
  }

  private async testNotification(type: NotificationType): Promise<void> {
    const config = await this.configService.load();
    const setting = config.notifications[type];

    if (setting.mode === 'talk') {
      await this.voiceService.preview(
        setting.voice || 'Ava',
        setting.text || type.replace(/_/g, ' '),
        config.volume
      );
    } else {
      await this.soundService.preview(setting.sound || 'Glass', config.volume);
    }
  }

  private sendMessage(message: ExtensionMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const webviewPath = vscode.Uri.joinPath(this._extensionUri, 'webview');

    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'main.js'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src ${cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <link rel="stylesheet" href="${codiconUri}">
  <title>Claude Notify</title>
</head>
<body>
  <div class="container">
    <!-- Notifications -->
    <section class="section">
      <h2>Notifications</h2>

      <!-- Response Complete (most important, working) -->
      <div class="notification-card" data-type="response_complete">
        <div class="notification-header">
          <button class="collapse-btn" aria-expanded="true">
            <span class="collapse-icon">▼</span>
            <span class="notification-title">Response Complete</span>
            <span class="codicon codicon-info info-icon" data-tooltip="Triggers when Claude finishes responding"></span>
          </button>
          <button class="btn btn-icon test-btn" title="Test">▶</button>
        </div>
        <div class="notification-body">
          <div class="setting-row">
            <label>Enabled</label>
            <label class="toggle">
              <input type="checkbox" class="notif-enabled" checked>
              <span class="slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <label>Mode</label>
            <select class="notif-mode">
              <option value="talk">Talk</option>
              <option value="sound">Sound</option>
            </select>
          </div>
          <div class="talk-settings">
            <div class="setting-row">
              <label>Voice</label>
              <select class="notif-voice"></select>
            </div>
            <div class="setting-row">
              <label>Text</label>
              <input type="text" class="notif-text" value="Response ready">
            </div>
          </div>
          <div class="sound-settings" style="display: none;">
            <div class="setting-row">
              <label>Sound</label>
              <select class="notif-sound"></select>
            </div>
          </div>
        </div>
      </div>

      <!-- Permission Prompt -->
      <div class="notification-card" data-type="permission_prompt">
        <div class="notification-header">
          <button class="collapse-btn" aria-expanded="false">
            <span class="collapse-icon">▶</span>
            <span class="notification-title">Permission Required</span>
            <span class="codicon codicon-info info-icon" data-tooltip="Triggers when Claude needs your permission"></span>
          </button>
          <button class="btn btn-icon test-btn" title="Test">▶</button>
        </div>
        <div class="notification-body collapsed">
          <div class="setting-row">
            <label>Enabled</label>
            <label class="toggle">
              <input type="checkbox" class="notif-enabled" checked>
              <span class="slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <label>Mode</label>
            <select class="notif-mode">
              <option value="talk">Talk</option>
              <option value="sound">Sound</option>
            </select>
          </div>
          <div class="talk-settings">
            <div class="setting-row">
              <label>Voice</label>
              <select class="notif-voice"></select>
            </div>
            <div class="setting-row">
              <label>Text</label>
              <input type="text" class="notif-text" value="Permission required">
            </div>
          </div>
          <div class="sound-settings" style="display: none;">
            <div class="setting-row">
              <label>Sound</label>
              <select class="notif-sound"></select>
            </div>
          </div>
        </div>
      </div>

      <!-- Elicitation Dialog -->
      <div class="notification-card" data-type="elicitation_dialog">
        <div class="notification-header">
          <button class="collapse-btn" aria-expanded="false">
            <span class="collapse-icon">▶</span>
            <span class="notification-title">Input Needed</span>
            <span class="codicon codicon-info info-icon" data-tooltip="Triggers when an MCP tool needs your input"></span>
          </button>
          <button class="btn btn-icon test-btn" title="Test">▶</button>
        </div>
        <div class="notification-body collapsed">
          <div class="setting-row">
            <label>Enabled</label>
            <label class="toggle">
              <input type="checkbox" class="notif-enabled" checked>
              <span class="slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <label>Mode</label>
            <select class="notif-mode">
              <option value="talk">Talk</option>
              <option value="sound">Sound</option>
            </select>
          </div>
          <div class="talk-settings">
            <div class="setting-row">
              <label>Voice</label>
              <select class="notif-voice"></select>
            </div>
            <div class="setting-row">
              <label>Text</label>
              <input type="text" class="notif-text" value="Input needed">
            </div>
          </div>
          <div class="sound-settings" style="display: none;">
            <div class="setting-row">
              <label>Sound</label>
              <select class="notif-sound"></select>
            </div>
          </div>
        </div>
      </div>

      <!-- Idle Prompt (Claude Waiting) -->
      <div class="notification-card" data-type="idle_prompt">
        <div class="notification-header">
          <button class="collapse-btn" aria-expanded="false">
            <span class="collapse-icon">▶</span>
            <span class="notification-title">Claude Waiting</span>
            <span class="codicon codicon-info info-icon" data-tooltip="Triggers after 60 seconds of waiting for your input"></span>
          </button>
          <button class="btn btn-icon test-btn" title="Test">▶</button>
        </div>
        <div class="notification-body collapsed">
          <div class="setting-row">
            <label>Enabled</label>
            <label class="toggle">
              <input type="checkbox" class="notif-enabled" checked>
              <span class="slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <label>Mode</label>
            <select class="notif-mode">
              <option value="talk">Talk</option>
              <option value="sound">Sound</option>
            </select>
          </div>
          <div class="talk-settings">
            <div class="setting-row">
              <label>Voice</label>
              <select class="notif-voice"></select>
            </div>
            <div class="setting-row">
              <label>Text</label>
              <input type="text" class="notif-text" value="Done">
            </div>
          </div>
          <div class="sound-settings" style="display: none;">
            <div class="setting-row">
              <label>Sound</label>
              <select class="notif-sound"></select>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Global Settings -->
    <section class="section">
      <h2>Global Settings</h2>

      <div class="setting-row">
        <label for="enabledToggle">Enabled</label>
        <label class="toggle">
          <input type="checkbox" id="enabledToggle" checked>
          <span class="slider"></span>
        </label>
      </div>

      <div class="setting-row">
        <label for="volumeSlider">Volume</label>
        <div class="slider-container">
          <input type="range" id="volumeSlider" min="0" max="100" value="70">
          <span id="volumeValue">70%</span>
        </div>
      </div>

      <div class="setting-row">
        <label for="cooldownSlider">Cooldown</label>
        <div class="slider-container">
          <input type="range" id="cooldownSlider" min="0" max="30" value="3">
          <span id="cooldownValue">3s</span>
        </div>
      </div>
    </section>

    <!-- Status Section -->
    <section class="section">
      <h2>Status</h2>
      <div class="status-row">
        <span class="status-indicator" id="statusIndicator"></span>
        <span id="statusText">Checking...</span>
      </div>
      <button id="installBtn" class="btn btn-primary">Install</button>
      <button id="restartBtn" class="btn btn-secondary" style="margin-top: 8px; display: none;">Restart Claude Code</button>
    </section>

  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  // Public methods for commands
  public async install(): Promise<void> {
    const config = await this.configService.load();
    await this.hookService.install(config);
    if (this._view) {
      this.sendMessage({ type: 'status', payload: { installed: true } });
    }
    vscode.window.showInformationMessage('Claude Notify hook installed successfully!');
  }

  public async remove(): Promise<void> {
    await this.hookService.remove();
    if (this._view) {
      this.sendMessage({ type: 'status', payload: { installed: false } });
    }
    vscode.window.showInformationMessage('Claude Notify hook removed.');
  }

  public async testAll(): Promise<void> {
    const config = await this.configService.load();
    const types: NotificationType[] = ['permission_prompt', 'idle_prompt', 'elicitation_dialog', 'response_complete'];

    for (const type of types) {
      const setting = config.notifications[type];
      if (!setting.enabled) continue;

      if (setting.mode === 'talk') {
        await this.voiceService.preview(
          setting.voice || 'Ava',
          setting.text || type.replace(/_/g, ' '),
          config.volume
        );
      } else {
        await this.soundService.preview(setting.sound || 'Glass', config.volume);
      }

      // Small delay between notifications
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeNotifyConfig, ClaudeSettings, ClaudeHookMatcher, DEFAULT_CONFIG } from '../types';

export class HookService {
  private readonly claudeDir: string;
  private readonly hooksDir: string;
  private readonly scriptPath: string;
  private readonly scriptBackupPath: string;
  private readonly stopScriptPath: string;
  private readonly permissionScriptPath: string;  // For PermissionRequest hook (VSCode IDE)
  private readonly settingsPath: string;
  private readonly settingsLockPath: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.hooksDir = path.join(this.claudeDir, 'hooks');
    this.scriptPath = path.join(this.hooksDir, 'notify.sh');
    this.scriptBackupPath = path.join(this.hooksDir, 'notify.sh.backup');
    this.stopScriptPath = path.join(this.hooksDir, 'stop-notify.sh');
    this.permissionScriptPath = path.join(this.hooksDir, 'permission-notify.sh');
    this.settingsPath = path.join(this.claudeDir, 'settings.json');
    this.settingsLockPath = path.join(this.claudeDir, 'settings.json.lock');
  }

  /**
   * Escape a string for safe use in bash double-quoted strings.
   * Escapes: $ ` \ " !
   */
  private escapeForBash(str: string): string {
    return str.replace(/[$`\\!"]/g, '\\$&');
  }

  /**
   * Validate and clamp a numeric value within bounds.
   */
  private clampNumber(value: unknown, min: number, max: number, defaultValue: number): number {
    const num = Number(value);
    if (isNaN(num)) {
      return defaultValue;
    }
    return Math.max(min, Math.min(max, num));
  }

  /**
   * Validate that a sound name contains only safe characters.
   * Allows alphanumeric, spaces, hyphens, and underscores.
   */
  private sanitizeSoundName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    return sanitized || 'Glass'; // Default fallback
  }

  /**
   * Validate config has required structure for script generation.
   * Returns a safe config with defaults applied for missing values.
   */
  validateConfig(config: unknown): ClaudeNotifyConfig {
    if (!config || typeof config !== 'object') {
      return DEFAULT_CONFIG;
    }

    const cfg = config as Partial<ClaudeNotifyConfig>;
    const notifications = cfg.notifications || {} as Partial<ClaudeNotifyConfig['notifications']>;

    const notificationTypes = [
      'permission_prompt',
      'idle_prompt',
      'elicitation_dialog',
      'response_complete'
    ] as const;

    const validatedNotifications: ClaudeNotifyConfig['notifications'] = {} as ClaudeNotifyConfig['notifications'];

    for (const type of notificationTypes) {
      const setting = notifications[type];
      const defaultSetting = DEFAULT_CONFIG.notifications[type];

      validatedNotifications[type] = {
        enabled: typeof setting?.enabled === 'boolean' ? setting.enabled : defaultSetting.enabled,
        mode: setting?.mode === 'talk' || setting?.mode === 'sound' ? setting.mode : defaultSetting.mode,
        voice: typeof setting?.voice === 'string' ? setting.voice : defaultSetting.voice,
        text: typeof setting?.text === 'string' ? setting.text : defaultSetting.text,
        sound: typeof setting?.sound === 'string' ? setting.sound : defaultSetting.sound,
      };
    }

    return {
      enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_CONFIG.enabled,
      volume: typeof cfg.volume === 'number' ? cfg.volume : DEFAULT_CONFIG.volume,
      cooldown: typeof cfg.cooldown === 'number' ? cfg.cooldown : DEFAULT_CONFIG.cooldown,
      notifications: validatedNotifications,
    };
  }

  /**
   * Create backup of existing script if it exists and wasn't created by us.
   */
  private async backupExistingScript(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.scriptPath, 'utf8');

      // Check if this is our auto-generated script
      if (content.includes('# Claude Code Notify - Auto-generated script')) {
        // Our script, no backup needed
        return;
      }

      // External script - create backup
      await fs.promises.copyFile(this.scriptPath, this.scriptBackupPath);
    } catch (error) {
      // File doesn't exist - no backup needed
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  /**
   * Acquire a lock for settings.json operations.
   * Uses a simple lockfile approach with timeout.
   */
  private async acquireSettingsLock(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    const retryInterval = 100;

    while (true) {
      try {
        // Try to create lockfile exclusively (fails if exists)
        await fs.promises.writeFile(this.settingsLockPath, String(process.pid), { flag: 'wx' });
        return; // Lock acquired
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error; // Unexpected error
        }

        // Lock exists - check if stale (older than 30 seconds)
        try {
          const stat = await fs.promises.stat(this.settingsLockPath);
          const lockAge = Date.now() - stat.mtimeMs;
          if (lockAge > 30000) {
            // Stale lock - remove and retry
            await fs.promises.unlink(this.settingsLockPath);
            continue;
          }
        } catch {
          // Lock file disappeared, retry
          continue;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          throw new Error('Timeout waiting for settings.json lock. Another process may be modifying Claude settings.');
        }

        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }

  /**
   * Release the settings.json lock.
   */
  private async releaseSettingsLock(): Promise<void> {
    try {
      await fs.promises.unlink(this.settingsLockPath);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Check if a hook entry matches our notification script path exactly.
   */
  private isOurNotificationHook(hook: ClaudeHookMatcher): boolean {
    return hook.hooks?.some((hk) => hk.command === this.scriptPath) ?? false;
  }

  /**
   * Check if a hook entry matches our stop script path exactly.
   */
  private isOurStopHook(hook: ClaudeHookMatcher): boolean {
    return hook.hooks?.some((hk) => hk.command === this.stopScriptPath) ?? false;
  }

  /**
   * Check if a hook entry matches our permission script path exactly.
   */
  private isOurPermissionHook(hook: ClaudeHookMatcher): boolean {
    return hook.hooks?.some((hk) => hk.command === this.permissionScriptPath) ?? false;
  }

  async isInstalled(): Promise<boolean> {
    try {
      // Check if script exists
      await fs.promises.access(this.scriptPath);

      // Check if hook is registered in settings
      const settings = await this.loadSettings();
      const hooks = settings?.hooks?.Notification;
      if (!Array.isArray(hooks)) {
        return false;
      }

      // Check for our hook using exact path match
      return hooks.some((h: ClaudeHookMatcher) => this.isOurNotificationHook(h));
    } catch {
      return false;
    }
  }

  async install(config: ClaudeNotifyConfig): Promise<void> {
    // 1. Create hooks directory
    await fs.promises.mkdir(this.hooksDir, { recursive: true });

    // 2. Backup existing script if it's not ours
    await this.backupExistingScript();

    // 3. Generate and write scripts
    const validatedConfig = this.validateConfig(config);
    const script = this.generateScript(validatedConfig);
    await fs.promises.writeFile(this.scriptPath, script, { mode: 0o755 });

    // 4. Generate and write stop script for response_complete
    const stopScript = this.generateStopScript(validatedConfig);
    await fs.promises.writeFile(this.stopScriptPath, stopScript, { mode: 0o755 });

    // 5. Generate and write permission script for PermissionRequest hook (VSCode IDE support)
    const permissionScript = this.generatePermissionScript(validatedConfig);
    await fs.promises.writeFile(this.permissionScriptPath, permissionScript, { mode: 0o755 });

    // 6. Update settings.json with proper hook format (with locking)
    await this.acquireSettingsLock();
    try {
      const settings = await this.loadSettings();
      settings.hooks = settings.hooks || {};

      // Remove only our hooks (exact path match) to avoid affecting other hooks
      if (settings.hooks.Notification) {
        settings.hooks.Notification = settings.hooks.Notification.filter(
          (h: ClaudeHookMatcher) => !this.isOurNotificationHook(h)
        );
      }
      if (settings.hooks.Stop) {
        settings.hooks.Stop = settings.hooks.Stop.filter(
          (h: ClaudeHookMatcher) => !this.isOurStopHook(h)
        );
      }
      if (settings.hooks.PermissionRequest) {
        settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter(
          (h: ClaudeHookMatcher) => !this.isOurPermissionHook(h)
        );
      }

      // Add our Notification hook entry - for Terminal CLI support
      // The script itself handles filtering by notification_type
      const notifyHook: ClaudeHookMatcher = {
        matcher: 'permission_prompt|idle_prompt|elicitation_dialog',
        hooks: [
          {
            type: 'command',
            command: this.scriptPath
          }
        ]
      };

      settings.hooks.Notification = settings.hooks.Notification || [];
      settings.hooks.Notification.push(notifyHook);

      // Add our PermissionRequest hook entry - for VSCode IDE support
      // This hook fires when Claude needs permission in the IDE
      const permissionHook: ClaudeHookMatcher = {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: this.permissionScriptPath
          }
        ]
      };

      settings.hooks.PermissionRequest = settings.hooks.PermissionRequest || [];
      settings.hooks.PermissionRequest.push(permissionHook);

      // Add our Stop hook entry for response_complete notifications
      const stopHook: ClaudeHookMatcher = {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: this.stopScriptPath
          }
        ]
      };

      settings.hooks.Stop = settings.hooks.Stop || [];
      settings.hooks.Stop.push(stopHook);

      await this.saveSettings(settings);
    } finally {
      await this.releaseSettingsLock();
    }
  }

  async remove(): Promise<void> {
    // 1. Remove hooks from settings (with locking)
    await this.acquireSettingsLock();
    try {
      const settings = await this.loadSettings();

      // Remove our Notification hook
      if (settings.hooks?.Notification) {
        settings.hooks.Notification = settings.hooks.Notification.filter(
          (h: ClaudeHookMatcher) => !this.isOurNotificationHook(h)
        );
        if (settings.hooks.Notification.length === 0) {
          delete settings.hooks.Notification;
        }
      }

      // Remove our Stop hook
      if (settings.hooks?.Stop) {
        settings.hooks.Stop = settings.hooks.Stop.filter(
          (h: ClaudeHookMatcher) => !this.isOurStopHook(h)
        );
        if (settings.hooks.Stop.length === 0) {
          delete settings.hooks.Stop;
        }
      }

      // Remove our PermissionRequest hook
      if (settings.hooks?.PermissionRequest) {
        settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter(
          (h: ClaudeHookMatcher) => !this.isOurPermissionHook(h)
        );
        if (settings.hooks.PermissionRequest.length === 0) {
          delete settings.hooks.PermissionRequest;
        }
      }

      if (settings.hooks && Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      await this.saveSettings(settings);
    } finally {
      await this.releaseSettingsLock();
    }

    // 2. Remove script files
    try {
      await fs.promises.unlink(this.scriptPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await fs.promises.unlink(this.stopScriptPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await fs.promises.unlink(this.permissionScriptPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async regenerateScript(config: ClaudeNotifyConfig): Promise<void> {
    const validatedConfig = this.validateConfig(config);

    // Regenerate notification script (for Terminal CLI)
    const script = this.generateScript(validatedConfig);
    await fs.promises.writeFile(this.scriptPath, script, { mode: 0o755 });

    // Regenerate stop script
    const stopScript = this.generateStopScript(validatedConfig);
    await fs.promises.writeFile(this.stopScriptPath, stopScript, { mode: 0o755 });

    // Regenerate permission script (for VSCode IDE)
    const permissionScript = this.generatePermissionScript(validatedConfig);
    await fs.promises.writeFile(this.permissionScriptPath, permissionScript, { mode: 0o755 });
  }

  private generateScript(config: ClaudeNotifyConfig): string {
    // Validate and clamp numeric values
    const volume = this.clampNumber(config.volume, 0, 100, 70);
    const volumeDecimal = volume / 100;
    const cooldown = this.clampNumber(config.cooldown, 0, 30, 3);

    let script = `#!/bin/bash
# Claude Code Notify - Auto-generated script
# Do not edit manually, changes will be overwritten

# ============ CONFIG ============
ENABLED="${config.enabled === true}"
VOLUME="${volumeDecimal}"
COOLDOWN="${cooldown}"
# ================================

# Exit if disabled
if [[ "$ENABLED" != "true" ]]; then
    exit 0
fi

# Cooldown check
LOCKFILE="/tmp/claude-notify.lock"
if [[ -f "$LOCKFILE" && "$COOLDOWN" -gt 0 ]]; then
    LAST=$(cat "$LOCKFILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    if (( NOW - LAST < COOLDOWN )); then
        exit 0
    fi
fi
echo $(date +%s) > "$LOCKFILE"

# Read notification type from stdin
INPUT=$(cat)
TYPE=$(echo "$INPUT" | grep -o '"notification_type"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"//')

# Play notification based on type
case "$TYPE" in
`;

    // Add cases for each notification type
    const types = [
      'permission_prompt',
      'idle_prompt',
      'elicitation_dialog'
    ] as const;

    for (const type of types) {
      const setting = config.notifications[type];

      if (!setting.enabled) {
        script += `    ${type})\n        # Disabled\n        ;;\n`;
        continue;
      }

      if (setting.mode === 'talk') {
        // Escape voice and text for safe bash double-quoted string usage
        const voice = this.escapeForBash(setting.voice || 'Ava');
        const text = this.escapeForBash(setting.text || type.replace(/_/g, ' '));

        script += `    ${type})
        (
            TMPFILE="/tmp/claude-notify-$$.aiff"
            say -v "${voice}" -o "$TMPFILE" "${text}"
            afplay -v $VOLUME "$TMPFILE"
            rm -f "$TMPFILE" 2>/dev/null
        ) &
        ;;
`;
      } else {
        // Sanitize sound name to prevent path traversal or injection
        const sound = this.sanitizeSoundName(setting.sound || 'Glass');
        script += `    ${type})
        afplay -v $VOLUME "/System/Library/Sounds/${sound}.aiff" &
        ;;
`;
      }
    }

    script += `    *)
        # Unknown notification type, ignore
        ;;
esac

exit 0
`;

    return script;
  }

  /**
   * Generate the PermissionRequest hook script for VSCode IDE.
   * This script runs when Claude needs permission in the IDE.
   * Note: The Notification hook doesn't work in VSCode IDE, so we use PermissionRequest instead.
   */
  private generatePermissionScript(config: ClaudeNotifyConfig): string {
    const volume = this.clampNumber(config.volume, 0, 100, 70);
    const volumeDecimal = volume / 100;
    const cooldown = this.clampNumber(config.cooldown, 0, 30, 3);

    const setting = config.notifications.permission_prompt;

    let script = `#!/bin/bash
# Claude Code Notify - PermissionRequest Hook Script (Auto-generated)
# Do not edit manually, changes will be overwritten
# This script runs when Claude needs permission in VSCode IDE

# ============ CONFIG ============
ENABLED="${config.enabled === true}"
PERMISSION_PROMPT_ENABLED="${setting.enabled === true}"
VOLUME="${volumeDecimal}"
COOLDOWN="${cooldown}"
# ================================

# Exit if disabled globally or permission_prompt is disabled
if [[ "$ENABLED" != "true" || "$PERMISSION_PROMPT_ENABLED" != "true" ]]; then
    exit 0
fi

# Cooldown check (use separate lockfile to not interfere with other hooks)
LOCKFILE="/tmp/claude-notify-permission.lock"
if [[ -f "$LOCKFILE" && "$COOLDOWN" -gt 0 ]]; then
    LAST=$(cat "$LOCKFILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    if (( NOW - LAST < COOLDOWN )); then
        exit 0
    fi
fi
echo $(date +%s) > "$LOCKFILE"

# Play notification
`;

    if (setting.mode === 'talk') {
      const voice = this.escapeForBash(setting.voice || 'Ava');
      const text = this.escapeForBash(setting.text || 'Permission required');

      script += `(
    TMPFILE="/tmp/claude-notify-permission-$$.aiff"
    say -v "${voice}" -o "$TMPFILE" "${text}"
    afplay -v $VOLUME "$TMPFILE"
    rm -f "$TMPFILE" 2>/dev/null
) &
`;
    } else {
      const sound = this.sanitizeSoundName(setting.sound || 'Glass');
      script += `afplay -v $VOLUME "/System/Library/Sounds/${sound}.aiff" &
`;
    }

    script += `
exit 0
`;

    return script;
  }

  /**
   * Generate the Stop hook script for response_complete notifications.
   * This script runs when Claude finishes responding.
   */
  private generateStopScript(config: ClaudeNotifyConfig): string {
    const volume = this.clampNumber(config.volume, 0, 100, 70);
    const volumeDecimal = volume / 100;
    const cooldown = this.clampNumber(config.cooldown, 0, 30, 3);

    const setting = config.notifications.response_complete;

    let script = `#!/bin/bash
# Claude Code Notify - Stop Hook Script (Auto-generated)
# Do not edit manually, changes will be overwritten
# This script runs when Claude finishes a response

# ============ CONFIG ============
ENABLED="${config.enabled === true}"
RESPONSE_COMPLETE_ENABLED="${setting.enabled === true}"
VOLUME="${volumeDecimal}"
COOLDOWN="${cooldown}"
# ================================

# Exit if disabled globally or response_complete is disabled
if [[ "$ENABLED" != "true" || "$RESPONSE_COMPLETE_ENABLED" != "true" ]]; then
    exit 0
fi

# Cooldown check (use separate lockfile to not interfere with notification hook)
LOCKFILE="/tmp/claude-notify-stop.lock"
if [[ -f "$LOCKFILE" && "$COOLDOWN" -gt 0 ]]; then
    LAST=$(cat "$LOCKFILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    if (( NOW - LAST < COOLDOWN )); then
        exit 0
    fi
fi
echo $(date +%s) > "$LOCKFILE"

# Play notification
`;

    if (setting.mode === 'talk') {
      const voice = this.escapeForBash(setting.voice || 'Ava');
      const text = this.escapeForBash(setting.text || 'Response ready');

      script += `(
    TMPFILE="/tmp/claude-notify-stop-$$.aiff"
    say -v "${voice}" -o "$TMPFILE" "${text}"
    afplay -v $VOLUME "$TMPFILE"
    rm -f "$TMPFILE" 2>/dev/null
) &
`;
    } else {
      const sound = this.sanitizeSoundName(setting.sound || 'Glass');
      script += `afplay -v $VOLUME "/System/Library/Sounds/${sound}.aiff" &
`;
    }

    script += `
exit 0
`;

    return script;
  }

  private async loadSettings(): Promise<ClaudeSettings> {
    try {
      const content = await fs.promises.readFile(this.settingsPath, 'utf8');
      return JSON.parse(content) as ClaudeSettings;
    } catch (error) {
      // Check if it's a file-not-found error (ENOENT)
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet - this is fine, return empty settings
        return {};
      }

      // Check if it's a JSON syntax error
      if (error instanceof SyntaxError) {
        throw new Error(
          'Claude Code settings.json is corrupted (invalid JSON). ' +
          'Please fix the file manually at ~/.claude/settings.json before installing the hook.'
        );
      }

      // Re-throw other unexpected errors
      throw new Error(`Failed to read Claude settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async saveSettings(settings: ClaudeSettings): Promise<void> {
    await fs.promises.mkdir(this.claudeDir, { recursive: true });

    const content = JSON.stringify(settings, null, 2);
    const tempPath = this.settingsPath + '.tmp';

    try {
      // Write to temporary file first
      await fs.promises.writeFile(tempPath, content, { mode: 0o644 });

      // Atomic rename - this ensures we don't corrupt settings.json on crash
      await fs.promises.rename(tempPath, this.settingsPath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to save Claude settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

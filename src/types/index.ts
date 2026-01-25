export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'elicitation_dialog'
  | 'response_complete';

export interface NotificationSetting {
  enabled: boolean;
  mode: 'talk' | 'sound';

  // Talk mode settings
  voice?: string;
  text?: string;

  // Sound mode settings
  sound?: string;
}

export interface ClaudeNotifyConfig {
  enabled: boolean;
  volume: number;
  cooldown: number;

  notifications: {
    permission_prompt: NotificationSetting;
    idle_prompt: NotificationSetting;
    elicitation_dialog: NotificationSetting;
    response_complete: NotificationSetting;
  };
}

export const DEFAULT_CONFIG: ClaudeNotifyConfig = {
  enabled: true,
  volume: 70,
  cooldown: 3,

  notifications: {
    permission_prompt: {
      enabled: true,
      mode: 'talk',
      voice: 'Ava (Premium)',
      text: 'Permission required'
    },
    idle_prompt: {
      enabled: true,
      mode: 'talk',
      voice: 'Ava (Premium)',
      text: 'Done'
    },
    elicitation_dialog: {
      enabled: true,
      mode: 'talk',
      voice: 'Ava (Premium)',
      text: 'Input needed'
    },
    response_complete: {
      enabled: true,
      mode: 'talk',
      voice: 'Ava (Premium)',
      text: 'Response ready'
    }
  }
};

// Webview → Extension messages
export type WebviewMessage =
  | { type: 'getConfig' }
  | { type: 'saveConfig'; payload: ClaudeNotifyConfig }
  | { type: 'getVoices' }
  | { type: 'getSounds' }
  | { type: 'getStatus' }
  | { type: 'install' }
  | { type: 'remove' }
  | { type: 'testNotification'; payload: { notificationType: NotificationType } }
  | { type: 'previewVoice'; payload: { voice: string; text: string } }
  | { type: 'previewSound'; payload: { sound: string } }
  | { type: 'restartClaude' };

// Extension → Webview messages
export type ExtensionMessage =
  | { type: 'config'; payload: ClaudeNotifyConfig }
  | { type: 'voices'; payload: Voice[] }
  | { type: 'sounds'; payload: SystemSound[] }
  | { type: 'status'; payload: { installed: boolean; justInstalled?: boolean } }
  | { type: 'saved'; payload: { success: boolean; error?: string } }
  | { type: 'error'; payload: { message: string } };

export interface Voice {
  name: string;
  locale: string;
}

export interface SystemSound {
  name: string;
  filename: string;
  path: string;
}

// Claude Code settings.json structure
export interface ClaudeHookEntry {
  type: 'command';
  command: string;
}

export interface ClaudeHookMatcher {
  matcher: string;
  hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
  hooks?: {
    Notification?: ClaudeHookMatcher[];
    [key: string]: ClaudeHookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

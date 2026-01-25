import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeNotifyConfig, DEFAULT_CONFIG } from '../types';

export class ConfigService {
  private readonly configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.claude', 'notify-config.json');
  }

  async load(): Promise<ClaudeNotifyConfig> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content);

      // Handle migration from old profile format
      if (parsed.profiles && parsed.currentProfile) {
        // Old profile format - extract current profile config
        const config = parsed.profiles[parsed.currentProfile] || DEFAULT_CONFIG;
        // Save in new format
        await this.save(this.mergeWithDefaults(config));
        return this.mergeWithDefaults(config);
      }

      return this.mergeWithDefaults(parsed);
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async save(config: ClaudeNotifyConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  private mergeWithDefaults(partial: Partial<ClaudeNotifyConfig>): ClaudeNotifyConfig {
    return {
      enabled: partial.enabled ?? DEFAULT_CONFIG.enabled,
      volume: partial.volume ?? DEFAULT_CONFIG.volume,
      cooldown: partial.cooldown ?? DEFAULT_CONFIG.cooldown,
      notifications: {
        permission_prompt: {
          ...DEFAULT_CONFIG.notifications.permission_prompt,
          ...partial.notifications?.permission_prompt
        },
        idle_prompt: {
          ...DEFAULT_CONFIG.notifications.idle_prompt,
          ...partial.notifications?.idle_prompt
        },
        elicitation_dialog: {
          ...DEFAULT_CONFIG.notifications.elicitation_dialog,
          ...partial.notifications?.elicitation_dialog
        },
        response_complete: {
          ...DEFAULT_CONFIG.notifications.response_complete,
          ...partial.notifications?.response_complete
        }
      }
    };
  }
}

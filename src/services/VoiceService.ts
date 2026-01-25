import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { Voice } from '../types';

const execAsync = promisify(exec);

export class VoiceService {
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

  async getVoices(): Promise<Voice[]> {
    try {
      const { stdout } = await execAsync("say -v '?'");

      return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          // Format: "Ava (Premium)       en_US    # Hello, my name is Ava."
          const match = line.match(/^(.+?)\s{2,}(\S+)/);
          if (match) {
            return { name: match[1].trim(), locale: match[2] };
          }
          return null;
        })
        .filter((v): v is Voice => v !== null);
    } catch (error) {
      console.error('Failed to get voices:', error);
      return [];
    }
  }

  async preview(voice: string, text: string, volume: number): Promise<void> {
    // Validate and clamp volume
    const safeVolume = this.clampNumber(volume, 0, 100, 70);
    const volumeDecimal = safeVolume / 100;

    // Properly escape for bash double-quoted strings
    const escapedText = this.escapeForBash(text);
    const escapedVoice = this.escapeForBash(voice);

    // Create temp file, speak to it, play with volume
    const tempFile = `/tmp/claude-notify-preview-${Date.now()}.aiff`;

    try {
      await execAsync(`say -v "${escapedVoice}" -o "${tempFile}" "${escapedText}"`);
      await execAsync(`afplay -v ${volumeDecimal} "${tempFile}"`);
    } finally {
      // Clean up temp file using fs instead of shell
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

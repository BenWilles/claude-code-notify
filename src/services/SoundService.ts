import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { SystemSound } from '../types';

const execAsync = promisify(exec);

export class SoundService {
  private readonly soundsDir = '/System/Library/Sounds';

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
   * Sanitize sound name to only allow safe characters.
   * Allows alphanumeric, spaces, hyphens, and underscores.
   */
  private sanitizeSoundName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    return sanitized || 'Glass';
  }

  async getSounds(): Promise<SystemSound[]> {
    try {
      const files = await fs.promises.readdir(this.soundsDir);

      return files
        .filter(f => f.endsWith('.aiff'))
        .map(filename => ({
          name: path.basename(filename, '.aiff'),
          filename,
          path: path.join(this.soundsDir, filename)
        }));
    } catch (error) {
      console.error('Failed to get sounds:', error);
      return [];
    }
  }

  async preview(soundName: string, volume: number): Promise<void> {
    // Validate volume
    const safeVolume = this.clampNumber(volume, 0, 100, 70);
    const volumeDecimal = safeVolume / 100;

    // Sanitize sound name to prevent path traversal
    const safeSoundName = this.sanitizeSoundName(soundName);
    const soundPath = path.join(this.soundsDir, `${safeSoundName}.aiff`);

    // Verify the file exists and is within the sounds directory
    try {
      const realPath = await fs.promises.realpath(soundPath);
      if (!realPath.startsWith(this.soundsDir)) {
        throw new Error('Invalid sound path');
      }
    } catch {
      throw new Error(`Sound file not found: ${safeSoundName}`);
    }

    try {
      await execAsync(`afplay -v ${volumeDecimal} "${soundPath}"`);
    } catch (error) {
      console.error('Failed to play sound:', error);
      throw error;
    }
  }
}

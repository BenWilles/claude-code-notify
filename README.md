# Claude Code Notify

Voice and sound notifications for Claude Code - Get notified when Claude needs your attention or completes a task.

## Features

This extension adds voice and sound notifications to Claude Code, so you can step away from your screen and still know when Claude needs your input. Choose between **text-to-speech announcements** with customizable voices or **system sounds** for each notification type.

### Notification Types

- **Permission Prompt** - When Claude needs permission to execute a command
- **Idle Prompt** - When Claude has finished and is waiting for your next input
- **Elicitation Dialog** - When Claude asks you a question
- **Response Complete** - When Claude has finished generating a response

### Notification Modes

Each notification type can be configured independently:

- **Talk Mode** - Uses macOS text-to-speech with customizable voice and text
- **Sound Mode** - Plays a system sound

### Additional Features

- Volume control
- Cooldown period to prevent notification spam
- Preview sounds and voices before saving
- One-click install/remove of Claude Code hooks

## Requirements

- **macOS only** - This extension uses macOS `say` command and system sounds
- **Claude Code** - The official Claude CLI from Anthropic

## Installation

1. Install the extension from the VS Code Marketplace
2. Click the Claude Notify icon in the Activity Bar
3. Click "Install Hook" to enable notifications
4. Configure your preferred notification settings
5. Restart Claude Code for changes to take effect

## Usage

After installation, the extension will automatically notify you based on your configured settings whenever Claude Code triggers a notification event.

Open the Claude Notify sidebar to:
- Enable/disable individual notification types
- Switch between talk and sound modes
- Customize voices and spoken text
- Preview notifications
- Adjust volume and cooldown settings

## Commands

- `Claude Notify: Install Hook` - Install the notification hook into Claude Code
- `Claude Notify: Remove Hook` - Remove the notification hook from Claude Code
- `Claude Notify: Test All Notifications` - Test all enabled notifications

## How It Works

The extension installs a hook into Claude Code's settings that triggers a notification script whenever Claude emits a notification event. The script reads your configuration and plays the appropriate audio feedback.

## Known Issues

- **VS Code Chat Panel**: In the VS Code chat panel, only **Response Complete** (`response_complete`) notifications work. The other notification types — Permission Prompt (`permission_prompt`), Idle Prompt (`idle_prompt`), and Elicitation Dialog (`elicitation_dialog`) — only work in the terminal. This is a [known limitation](https://github.com/anthropics/claude-code/issues/11156) on the Claude Code side.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

[Ben Willes](https://benwilles.com)

## Contributing

Issues and pull requests are welcome at [GitHub](https://github.com/BenWilles/claude-code-notify).

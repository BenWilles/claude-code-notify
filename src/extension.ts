import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';

let sidebarProvider: SidebarProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Code Notify is now active');

  // Create sidebar provider
  sidebarProvider = new SidebarProvider(context.extensionUri);

  // Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-notify.install', async () => {
      await sidebarProvider.install();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-notify.remove', async () => {
      await sidebarProvider.remove();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-notify.testAll', async () => {
      await sidebarProvider.testAll();
    })
  );
}

export function deactivate() {
  console.log('Claude Code Notify deactivated');
}

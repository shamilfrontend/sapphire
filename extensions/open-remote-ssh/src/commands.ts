/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import { getRemoteAuthority } from './authResolver';
import SSHConfiguration, { getSSHConfigPath } from './ssh/sshConfig';
import { exists as fileExists } from './common/files';
import SSHDestination from './ssh/sshDestination';

type HostQuickPickItem = vscode.QuickPickItem & {
  action?: 'add' | 'configure' | 'enterHost';
  hostname?: string;
};

export async function promptOpenRemoteSSHWindow(reuseWindow: boolean) {
  const sshConfigFile = await SSHConfiguration.loadFromFS();
  const hosts = sshConfigFile.getAllConfiguredHosts();

  const items: HostQuickPickItem[] = hosts.map((hostname) => ({
    label: hostname,
    description: 'Connect',
    hostname,
  }));

  if (items.length) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  }

  items.push(
    {
      label: '$(pencil) Enter host manually...',
      description: '[user@]hostname[:port]',
      action: 'enterHost',
    },
    {
      label: '$(plus) Add New SSH Host...',
      action: 'add',
    },
    {
      label: '$(gear) Configure SSH Hosts...',
      action: 'configure',
    },
  );

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select SSH Host',
    placeHolder: hosts.length ? 'Select a host to connect' : 'No hosts in SSH config',
    matchOnDescription: true,
  });

  if (!picked) {
    return;
  }

  if (picked.action === 'add') {
    await addNewHost();
    return;
  }
  if (picked.action === 'configure') {
    await openSSHConfigFile();
    return;
  }
  if (picked.action === 'enterHost') {
    const host = await vscode.window.showInputBox({
      title: 'Enter [user@]hostname[:port]',
    });
    if (!host) {
      return;
    }
    const sshDest = new SSHDestination(host);
    openRemoteSSHWindow(sshDest.toEncodedString(), reuseWindow);
    return;
  }

  if (picked.hostname) {
    const sshDest = new SSHDestination(picked.hostname);
    openRemoteSSHWindow(sshDest.toEncodedString(), reuseWindow);
  }
}

export function openRemoteSSHWindow(host: string, reuseWindow: boolean) {
  vscode.commands.executeCommand('vscode.newWindow', {
    remoteAuthority: getRemoteAuthority(host),
    reuseWindow,
  });
}

export function openRemoteSSHLocationWindow(host: string, path: string, reuseWindow: boolean) {
  vscode.commands.executeCommand(
    'vscode.openFolder',
    vscode.Uri.from({ scheme: 'vscode-remote', authority: getRemoteAuthority(host), path }),
    { forceNewWindow: !reuseWindow },
  );
}

export async function addNewHost() {
  const sshConfigPath = getSSHConfigPath();
  if (!(await fileExists(sshConfigPath))) {
    await fs.promises.appendFile(sshConfigPath, '');
  }

  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sshConfigPath), {
    preview: false,
  });

  const textEditor = vscode.window.activeTextEditor;
  if (textEditor?.document.uri.fsPath !== sshConfigPath) {
    return;
  }

  const textDocument = textEditor.document;
  const lastLine = textDocument.lineAt(textDocument.lineCount - 1);

  if (!lastLine.isEmptyOrWhitespace) {
    await textEditor.edit((editBuilder: vscode.TextEditorEdit) => {
      editBuilder.insert(lastLine.range.end, '\n');
    });
  }

  const snippet = '\nHost ${1:dev}\n\tHostName ${2:dev.example.com}\n\tUser ${3:john}';
  await textEditor.insertSnippet(
    new vscode.SnippetString(snippet),
    new vscode.Position(textDocument.lineCount, 0),
  );
}

export async function openSSHConfigFile() {
  const sshConfigPath = getSSHConfigPath();
  if (!(await fileExists(sshConfigPath))) {
    await fs.promises.appendFile(sshConfigPath, '');
  }
  vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sshConfigPath));
}

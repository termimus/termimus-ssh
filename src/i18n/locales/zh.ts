import type { TranslationSchema } from "./en";
import { commonZh } from "./zh/common";
import { navigationZh } from "./zh/navigation";
import { hostsZh } from "./zh/hosts";
import { terminalZh } from "./zh/terminal";
import { sftpZh } from "./zh/sftp";
import { keychainZh } from "./zh/keychain";
import { workspacesZh } from "./zh/workspaces";
import { tunnelsZh } from "./zh/tunnels";
import { snippetsZh } from "./zh/snippets";
import { vaultZh } from "./zh/vault";
import { settingsZh } from "./zh/settings";

export const zh: TranslationSchema = {
  common: commonZh,
  nav: navigationZh,
  hosts: hostsZh,
  terminal: terminalZh,
  sftp: sftpZh,
  keychain: keychainZh,
  workspaces: workspacesZh,
  tunnels: tunnelsZh,
  snippets: snippetsZh,
  vault: vaultZh,
  settings: settingsZh,
};

import { commonEn } from "./en/common";
import { navigationEn } from "./en/navigation";
import { hostsEn } from "./en/hosts";
import { terminalEn } from "./en/terminal";
import { sftpEn } from "./en/sftp";
import { keychainEn } from "./en/keychain";
import { workspacesEn } from "./en/workspaces";
import { tunnelsEn } from "./en/tunnels";
import { snippetsEn } from "./en/snippets";
import { vaultEn } from "./en/vault";
import { settingsEn } from "./en/settings";

export const en = {
  common: commonEn,
  nav: navigationEn,
  hosts: hostsEn,
  terminal: terminalEn,
  sftp: sftpEn,
  keychain: keychainEn,
  workspaces: workspacesEn,
  tunnels: tunnelsEn,
  snippets: snippetsEn,
  vault: vaultEn,
  settings: settingsEn,
};

export type TranslationSchema = typeof en;

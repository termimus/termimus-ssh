import type { TranslationSchema } from "./en";
import { commonId } from "./id/common";
import { navigationId } from "./id/navigation";
import { hostsId } from "./id/hosts";
import { terminalId } from "./id/terminal";
import { sftpId } from "./id/sftp";
import { keychainId } from "./id/keychain";
import { workspacesId } from "./id/workspaces";
import { tunnelsId } from "./id/tunnels";
import { snippetsId } from "./id/snippets";
import { vaultId } from "./id/vault";
import { settingsId } from "./id/settings";

export const id: TranslationSchema = {
  common: commonId,
  nav: navigationId,
  hosts: hostsId,
  terminal: terminalId,
  sftp: sftpId,
  keychain: keychainId,
  workspaces: workspacesId,
  tunnels: tunnelsId,
  snippets: snippetsId,
  vault: vaultId,
  settings: settingsId,
};

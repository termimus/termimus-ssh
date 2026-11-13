# SSH Agent Authentication

Termimus can authenticate to a host with a key held by your local **SSH agent**
instead of a stored password or an imported private key. No private key
material is ever imported into Termimus — the agent only signs the login
challenge, and the private key never leaves the agent (or your vault).

This is **agent-agnostic**: Termimus talks the standard SSH agent protocol to
whatever agent is listening at the standard endpoint, so it works with
Bitwarden, 1Password, KeePassXC, and the system OpenSSH agent alike. Pick the
agent you already use; the setup for each is below.

## What Termimus needs

- An SSH agent **running** on your machine.
- The key **loaded** in that agent.
- For password managers: the vault **unlocked** (Bitwarden and 1Password
  prompt you to unlock / authorize on first use).
- The key's **public key in the server's `~/.ssh/authorized_keys`**.

How Termimus reaches the agent:

- **Windows:** the OpenSSH agent named pipe, `\\.\pipe\openssh-ssh-agent`.
  Only **one** agent can own this pipe at a time — if you use Bitwarden or
  1Password, the built-in Windows OpenSSH Authentication Agent service must
  be disabled; if you use the system OpenSSH agent, that service is the one
  that owns it.
- **macOS / Linux:** the socket named by the `SSH_AUTH_SOCK` environment
  variable.

## Using it in Termimus

1. Create a host (or edit an existing one).
2. In **Auth Method**, choose **SSH Agent**.
3. Save, then connect.

That is all — there is no key to import and no credential is stored.
Termimus asks the agent to sign the login challenge, trying each identity
the agent holds in turn until the server accepts one. If the server also
requires a second factor, the usual keyboard-interactive prompt follows,
exactly as with private-key auth.

## 1. Bitwarden

Bitwarden Desktop can act as an SSH agent, keeping your keys encrypted in
your vault. This is the primary path — it is also the setup the Termimus
maintainer uses.

1. **Install Bitwarden Desktop.** The SSH agent is a desktop-app feature;
   the browser extension and CLI do not provide it. (Note: the macOS App
   Store build does not support the SSH agent — use the `.dmg` download.)
2. **Store the key in your vault.** Create an **SSH key** item
   (**New → SSH key**). Generate a new key (ED25519 only) or import an
   existing one with **Import key from clipboard** — imported keys must be in
   OpenSSH or PKCS#8 format (PuTTY keys are not compatible). Organization-
   owned SSH keys cannot be used in the agent.
3. **Enable the agent.** In Bitwarden Desktop, go to **Settings** and turn
   on **Enable SSH agent**. Adjust **Ask for authorization when using SSH
   agent** to control when Bitwarden asks you to approve a key use.
4. **Windows only — free the named pipe.** Bitwarden and the built-in
   Windows OpenSSH service both want `\\.\pipe\openssh-ssh-agent`, so the
   Windows service must be disabled: open **Services → OpenSSH
   Authentication Agent**, set **Startup type** to **Disabled**, then
   **Apply** and **OK**.
5. **Unlock your vault.** A locked vault will prompt you to unlock on first
   use; once unlocked, the agent can sign.
6. **Verify.** Run `ssh-add -L` — it should list the public keys from your
   vault.

## 2. 1Password

1. **Store the key in your vault.** Create an **SSH Key** item
   (**New Item → SSH Key → Add Private Key → Generate New Key**), choose
   **Ed25519** or **RSA**, then **Generate** and **Save**. You can also
   import an existing key into an SSH Key item.
2. **Windows only — free the named pipe.** Check **Services → OpenSSH
   Authentication Agent** (Win+R, `services.msc`). If it is listed, set its
   **Startup type** to **Disabled** and, if it is running, **Stop** it, then
   **Apply** → **OK**. 1Password then takes over
   `\\.\pipe\openssh-ssh-agent`.
3. **Enable the agent.** In 1Password, go to **Settings → Developer** and
   turn on **Use the SSH Agent**. Choose whether to display key names in
   authorization prompts, and optionally adjust how often the agent asks you
   to approve requests. To keep the agent running, also enable **Keep
   1Password in the menu bar** (macOS) / **Keep 1Password in the
   notification area** (Windows) and **Start at login** under
   **Settings → General**.
4. **Unlock 1Password.** You will be prompted to approve (Touch ID, Windows
   Hello, or account password) the first time a key is used.
5. **Verify.** Run `ssh-add -l` — it should list the keys from your vault.

## 3. KeePassXC

KeePassXC's SSH Agent integration **does not provide an agent itself** — it
loads keys into an OpenSSH-compatible agent that must already be running.
On Windows that means the OpenSSH Authentication Agent service; on macOS and
Linux it is the system `ssh-agent`.

1. **Make sure an agent is running.** On Windows, enable the OpenSSH
   Authentication Agent service: set its **Startup type** to **Automatic**
   and start it — or, in an elevated PowerShell:
   `Get-Service ssh-agent | Set-Service -StartupType Automatic` followed by
   `Start-Service ssh-agent`. On macOS and Linux the system `ssh-agent` is
   used automatically and is usually already running on a graphical desktop
   (check with `ssh-add -l`).
2. **Enable the integration.** In KeePassXC, go to **Tools → Settings →
   SSH Agent** and check **Enable SSH Agent integration**. On Windows,
   choose **OpenSSH for Windows** (Pageant is PuTTY's agent, not the
   OpenSSH pipe Termimus uses).
3. **Attach the key to an entry.** Generate a key with `ssh-keygen` if you
   do not have one, then create or edit an entry: put the key's passphrase
   in the password field, attach the key file on the **Advanced** tab, and
   on the **SSH Agent** tab select the attachment and choose the autoload
   options (add the key when the database is opened/unlocked, remove it when
   closed/locked). You can also load a key manually from the entry's context
   menu.
4. **Unlock the database** so the key is loaded into the agent.
5. **Verify.** Run `ssh-add -l` — it should list the key.

## 4. System OpenSSH agent

Use this if you do not use a password manager's agent — the key lives as a
file (typically under `~/.ssh/`) and `ssh-agent` serves it.

### Windows

The OpenSSH Authentication Agent service is disabled by default. In an
**elevated** PowerShell:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
Get-Service ssh-agent   # should show Running
```

Then load your key from a **normal** (non-admin) PowerShell:

```powershell
ssh-add $env:USERPROFILE\.ssh\id_ed25519
ssh-add -l   # should list the key
```

### macOS / Linux

On most Linux graphical desktops and on macOS the agent is already running
(macOS starts it automatically on first use). Check with:

```sh
ssh-add -l
```

If that reports `Could not open a connection to your authentication agent`,
start it and load your key:

```sh
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
ssh-add -l   # should list the key
```

## Troubleshooting

- **Termimus cannot reach the agent / `ssh-add -l` reports "Could not open
  a connection to your authentication agent".** The agent is not running,
  or, on Windows, another agent or service owns the named pipe. Start your
  agent, and on Windows make sure exactly one agent owns
  `\\.\pipe\openssh-ssh-agent`: disable the Windows OpenSSH service when
  you use Bitwarden or 1Password; enable it when you use the system agent
  (or KeePassXC with OpenSSH for Windows).
- **Vault locked.** Unlock the vault. Bitwarden and 1Password prompt you to
  unlock / authorize on first use; until you approve, the agent cannot sign.
- **"The agent has no identities" / the key is not offered.** The key is
  not loaded in the agent. `ssh-add -l` shows what the agent holds — if it
  is empty, load or add the key using the steps for your agent above.
- **Server rejects the key ("SSH agent key rejected by server").** The
  public key is not in the server's `~/.ssh/authorized_keys`. Get the public
  key with `ssh-add -L` and add it to `authorized_keys` on the server. Also
  note that if the agent holds many keys, the server may hit its
  authentication-attempt limit before the right key is tried — remove
  unneeded keys from the agent.
- **Approval prompt missed.** Bitwarden and 1Password ask you to approve
  each use (configurable). If you dismiss or miss the prompt, the connection
  fails — just connect again and approve it.

## References

- Bitwarden — SSH Agent: <https://bitwarden.com/help/ssh-agent/>
- Bitwarden — About SSH (SSH key items, supported key types):
  <https://bitwarden.com/help/about-ssh/>
- 1Password — Get started with 1Password for SSH:
  <https://www.1password.dev/ssh/get-started>
- KeePassXC — SSH Agent integration:
  <https://github.com/keepassxreboot/keepassxc/blob/develop/docs/topics/SSHAgent.adoc>
- Microsoft Learn — Key-Based Authentication in OpenSSH for Windows:
  <https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement>
- GitHub Docs — Generating a new SSH key and adding it to the ssh-agent:
  <https://docs.github.com/en/enterprise-server@3.12/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent>

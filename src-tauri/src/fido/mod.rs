//! OpenSSH security-key authentication. The SSH client owns the challenge and
//! the token owns the private key; this adapter never exposes a signing IPC.

mod linux;
#[cfg(test)]
mod tests;

use crate::ssh::{ask_auth_prompt, with_security_key_touch, AuthPromptField, AuthPromptPayload};
use russh::keys::{
    agent::AgentIdentity,
    ssh_key::{Algorithm, Signature},
    PrivateKey, PublicKey,
};
use sha2::{Digest, Sha256};
use signature::Verifier;
use std::{
    sync::{Arc, LazyLock},
    time::Duration,
};
use tauri::AppHandle;
use tokio::sync::{oneshot, Semaphore};
use zeroize::{Zeroize, Zeroizing};

const USER_PRESENCE: u8 = 0x01;
const USER_VERIFICATION: u8 = 0x04;
static DEVICE_ACCESS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(1)));

struct KeyHandle {
    application: String,
    credential_id: Zeroizing<Vec<u8>>,
    flags: u8,
}

impl KeyHandle {
    fn from_private_key(private_key: &PrivateKey) -> Result<Self, String> {
        let key = private_key.key_data();
        let (application, handle, flags) = if let Some(sk) = key.sk_ecdsa_p256() {
            (sk.public().application(), sk.key_handle(), sk.flags())
        } else if let Some(sk) = key.sk_ed25519() {
            (sk.public().application(), sk.key_handle(), sk.flags())
        } else {
            return Err("Not an OpenSSH security-key handle".into());
        };
        if !application.starts_with("ssh:") || application.contains('\0') {
            return Err("A FIDO2 SSH key must use an ssh: application".into());
        }
        if handle.is_empty() || handle.len() > 1024 {
            return Err("Invalid FIDO2 SSH credential ID".into());
        }
        Ok(Self {
            application: application.to_owned(),
            credential_id: Zeroizing::new(handle.to_vec()),
            flags,
        })
    }
}

struct Assertion {
    signature: Vec<u8>,
    flags: u8,
    counter: u32,
}

enum DeviceError {
    PinRequired,
    Failed(String),
}

#[derive(Debug)]
pub(crate) struct SignError(String);

impl std::fmt::Display for SignError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl From<russh::SendError> for SignError {
    fn from(_: russh::SendError) -> Self {
        Self("SSH connection closed during security-key authentication".into())
    }
}

pub(crate) struct SecurityKeySigner<'a> {
    app: &'a AppHandle,
    target: &'a str,
    key: Arc<KeyHandle>,
    public_key: PublicKey,
    signed: bool,
}

impl<'a> SecurityKeySigner<'a> {
    pub(crate) fn new(
        app: &'a AppHandle,
        target: &'a str,
        key: &PrivateKey,
        verify_required: bool,
    ) -> Result<Self, String> {
        let mut handle = KeyHandle::from_private_key(key)?;
        if verify_required {
            handle.flags |= USER_VERIFICATION;
        }
        Ok(Self {
            app,
            target,
            key: Arc::new(handle),
            public_key: key.public_key().clone(),
            signed: false,
        })
    }

    pub(crate) fn signed(&self) -> bool {
        self.signed
    }

    fn prompt(&self, mode: &'static str, prompts: Vec<AuthPromptField>) -> AuthPromptPayload {
        AuthPromptPayload {
            request_id: uuid::Uuid::new_v4().to_string(),
            target: self.target.to_owned(),
            name: String::new(),
            instructions: String::new(),
            prompts,
            security_key: Some(mode),
        }
    }

    async fn request_pin(&self) -> Result<Zeroizing<Vec<u8>>, String> {
        let prompts = vec![AuthPromptField {
            prompt: String::new(),
            echo: false,
        }];
        let mut answers =
            Zeroizing::new(ask_auth_prompt(self.app, self.prompt("pin", prompts)).await?);
        if answers.len() != 1 {
            return Err("Expected one security key PIN".into());
        }
        let mut bytes = Zeroizing::new(std::mem::take(&mut answers[0]).into_bytes());
        if !(4..=63).contains(&bytes.len()) || bytes.contains(&0) {
            return Err("Invalid security key PIN length or format".into());
        }
        // Avoid a reallocation leaving the original PIN in an old buffer.
        let mut terminated = Zeroizing::new(Vec::with_capacity(bytes.len() + 1));
        terminated.extend_from_slice(&bytes);
        terminated.push(0);
        bytes.zeroize();
        Ok(terminated)
    }

    async fn sign(&self, mut challenge: Vec<u8>) -> Result<Vec<u8>, String> {
        let hash = Sha256::digest(&challenge).into();
        let permit = tokio::time::timeout(
            Duration::from_secs(60),
            DEVICE_ACCESS.clone().acquire_owned(),
        )
        .await
        .map_err(|_| "Another connection is using the security key; try again".to_string())?
        .map_err(|_| "Security key is unavailable".to_string())?;
        let key = self.key.clone();
        let (pin_requested, pin_request) = oneshot::channel();
        let mut worker = tokio::task::spawn_blocking(move || {
            // Retain exclusive access until native I/O completes even if the
            // caller cancels and drops its join handle.
            let _permit = permit;
            linux::sign(&key, &hash, || {
                let (tx, rx) = oneshot::channel();
                let cancelled =
                    || DeviceError::Failed("Security key authentication cancelled".into());
                pin_requested.send(tx).map_err(|_| cancelled())?;
                rx.blocking_recv().map_err(|_| cancelled())
            })
        });
        let phase = with_security_key_touch(self.app, self.prompt("touch", vec![]), async {
            tokio::select! {
                Ok(pin_response) = pin_request => Err(pin_response),
                completed = &mut worker => Ok(completed),
            }
        })
        .await?;
        let completed = match phase {
            Ok(completed) => completed,
            Err(pin_response) => {
                let pin = self.request_pin().await?;
                with_security_key_touch(self.app, self.prompt("touch", vec![]), async move {
                    let _ = pin_response.send(pin);
                    worker.await
                })
                .await?
            }
        };
        let assertion = match completed.map_err(|_| "Security key worker stopped unexpectedly")? {
            Ok(value) => value,
            Err(DeviceError::PinRequired) => {
                return Err(
                    "The security key did not accept the PIN; check its configuration".into(),
                )
            }
            Err(DeviceError::Failed(error)) => return Err(error),
        };
        let signature = encode_assertion(&self.public_key, self.key.flags, &challenge, assertion)?;
        let len = u32::try_from(signature.len()).map_err(|_| "Security-key signature too large")?;
        challenge.extend_from_slice(&len.to_be_bytes());
        challenge.extend(signature);
        Ok(challenge)
    }
}

impl russh::Signer for SecurityKeySigner<'_> {
    type Error = SignError;

    async fn auth_sign(
        &mut self,
        identity: &AgentIdentity,
        hash_alg: Option<russh::keys::HashAlg>,
        challenge: Vec<u8>,
    ) -> Result<Vec<u8>, Self::Error> {
        if identity.public_key().key_data() != self.public_key.key_data() || hash_alg.is_some() {
            return Err(SignError(
                "SSH requested a signature for a different security key".into(),
            ));
        }
        let signed = self.sign(challenge).await.map_err(SignError)?;
        self.signed = true;
        Ok(signed)
    }
}

fn encode_assertion(
    key: &PublicKey,
    required_flags: u8,
    challenge: &[u8],
    assertion: Assertion,
) -> Result<Vec<u8>, String> {
    let required = required_flags & (USER_PRESENCE | USER_VERIFICATION);
    if assertion.flags & required != required {
        return Err("The security key did not confirm required presence or verification".into());
    }
    let algorithm = key.algorithm();
    let mut raw = match algorithm {
        Algorithm::SkEcdsaSha2NistP256 => {
            let ecdsa = p256::ecdsa::Signature::from_der(&assertion.signature)
                .map_err(|_| "Invalid ECDSA signature from security key")?;
            Signature::try_from(&ecdsa)
                .map_err(|_| "Could not encode ECDSA signature")?
                .as_bytes()
                .to_vec()
        }
        Algorithm::SkEd25519 => assertion.signature,
        _ => return Err("Unsupported security-key signature algorithm".into()),
    };
    raw.push(assertion.flags);
    raw.extend_from_slice(&assertion.counter.to_be_bytes());
    let signature =
        Signature::new(algorithm, raw).map_err(|_| "Invalid SK signature from the token")?;
    Verifier::verify(key, challenge, &signature)
        .map_err(|_| "The security key produced a signature that does not match the SSH key")?;
    Vec::try_from(signature).map_err(|_| "Could not encode SSH security-key signature".into())
}

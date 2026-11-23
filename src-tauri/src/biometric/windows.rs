//! Windows Hello (UserConsentVerifier) implementation.
//!
//! Uses the WinRT `Windows.Security.Credentials.UI.UserConsentVerifier` API
//! to prompt for Windows Hello verification (fingerprint, face, or PIN).
//!
//! Caveat: `UserConsentVerifier::RequestVerificationAsync` is documented by
//! Microsoft as the UWP path. For an unpackaged desktop app the supported
//! alternative is `IUserConsentVerifierInterop::RequestVerificationForWindowAsync`,
//! which needs the owning window handle. This module uses the plain
//! `RequestVerificationAsync` call, so on an unpackaged desktop build the
//! prompt may fail — if it does, the interop path (passing the Tauri window
//! HWND through the command) is the fix.

use windows::core::HSTRING;
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

/// Initialise the WinRT apartment for the calling thread (best effort).
/// `vault_biometric_unlock` runs this on a tokio `spawn_blocking` thread,
/// which is not COM-initialised; WinRT activation fails without it.
/// An already-initialised thread reports an error here, which is fine to
/// ignore.
fn ensure_winrt_apartment() {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

/// Check if Windows Hello verification is available and enrolled for the
/// current user.
pub fn is_supported() -> bool {
    ensure_winrt_apartment();
    match UserConsentVerifier::CheckAvailabilityAsync() {
        Ok(op) => match op.join() {
            Ok(availability) => availability == UserConsentVerifierAvailability::Available,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Prompt the user for Windows Hello verification.
pub fn authenticate(reason: &str) -> Result<bool, String> {
    ensure_winrt_apartment();
    let message = HSTRING::from(reason);
    let op = UserConsentVerifier::RequestVerificationAsync(&message)
        .map_err(|e| format!("Windows Hello verification failed to start: {e}"))?;
    let result = op
        .join()
        .map_err(|e| format!("Windows Hello verification failed: {e}"))?;
    Ok(result == UserConsentVerificationResult::Verified)
}

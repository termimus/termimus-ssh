//! Biometric authentication module (Touch ID on macOS, Windows Hello on
//! Windows, platform fallbacks).
//!
//! Provides a unified, maintainable interface for hardware-backed authentication:
//! - `is_supported()`: returns whether biometric hardware is available and enrolled.
//! - `authenticate(reason)`: requests user verification with a localized reason string.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unsupported;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use unsupported::*;

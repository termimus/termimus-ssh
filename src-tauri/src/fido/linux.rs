//! Linux hardware-key signing via the installed libfido2 (Ubuntu 22.04 ABI).
//!
//! Call on a serialized blocking worker. The timeouts cover CTAP exchanges,
//! not every OS call: for example, libfido2 1.10's hidraw open can spend up to
//! 12 extra seconds waiting for its advisory lock. The selection deadline
//! prevents starting more exchanges after this, but cannot interrupt native I/O.

use std::ffi::{c_char, c_int, c_uint, CStr, CString};
use std::ptr;
use std::slice;
use std::time::{Duration, Instant};

use libloading::Library;

use super::{Assertion, DeviceError, KeyHandle, USER_PRESENCE, USER_VERIFICATION};

const MAX_DEVICES: usize = 8;
const SELECTION_BUDGET: Duration = Duration::from_secs(8);
const PROBE_MS: c_int = 1_500;
const SIGN_MS: c_int = 30_000;
const MAX_APPLICATION_BYTES: usize = 1_024;
const MAX_CREDENTIAL_BYTES: usize = 1_024;
// SSH security keys use raw Ed25519 (64 bytes) or DER-encoded P-256 (up to 72).
const MAX_SIGNATURE_BYTES: usize = 72;

// libfido2 1.10 src/fido.h and src/fido/{types,err}.h. fido_opt_t is an
// int-sized C enum on Linux; the C bool results below are _Bool.
const FIDO_DISABLE_U2F_FALLBACK: c_int = 0x02;
const FIDO_OPT_FALSE: c_uint = 1;
const FIDO_OPT_TRUE: c_uint = 2;
const FIDO_OK: c_int = 0;
const FIDO_ERR_USER_PRESENCE_REQUIRED: c_int = -8;
const FIDO_ERR_NO_CREDENTIALS: c_int = 0x2e;
const FIDO_ERR_PIN_INVALID: c_int = 0x31;
const FIDO_ERR_PIN_BLOCKED: c_int = 0x32;
const FIDO_ERR_PIN_AUTH_BLOCKED: c_int = 0x34;
const FIDO_ERR_PIN_REQUIRED: c_int = 0x36; // CTAP2.1: PUAT_REQUIRED
const FIDO_ERR_UV_BLOCKED: c_int = 0x3c;
const FIDO_ERR_UV_INVALID: c_int = 0x3f;

#[repr(C)]
struct FidoDevInfo {
    _opaque: [u8; 0],
}
#[repr(C)]
struct FidoDev {
    _opaque: [u8; 0],
}
#[repr(C)]
struct FidoAssert {
    _opaque: [u8; 0],
}

macro_rules! fido_api {
    ($($symbol:ident: $signature:ty),+ $(,)?) => {
        struct Api {
            $($symbol: $signature,)+
            // Copied function pointers and all C allocations are used only
            // while this library is alive; the allocation guards borrow Api.
            _library: Library,
        }

        impl Api {
            fn load() -> Result<Self, DeviceError> {
                // SAFETY: load only the system ABI's fixed SONAME, never a
                // path derived from a key, a PIN, or an authenticator.
                let library = unsafe { Library::new("libfido2.so.1") }
                    .map_err(|_| failed("Cannot load libfido2.so.1; install the Linux libfido2 runtime."))?;
                $(
                    // SAFETY: these names and function types match the 1.10
                    // headers. Missing symbols fail before any device I/O.
                    let $symbol = *unsafe {
                        library.get::<$signature>(concat!(stringify!($symbol), "\0").as_bytes())
                    }.map_err(|_| failed(concat!("Incompatible libfido2: missing ", stringify!($symbol))))?;
                )+
                Ok(Self { $($symbol,)+ _library: library })
            }
        }
    };
}

fido_api! {
    fido_init: unsafe extern "C" fn(c_int),
    fido_set_log_handler: unsafe extern "C" fn(unsafe extern "C" fn(*const c_char)),
    fido_dev_info_new: unsafe extern "C" fn(usize) -> *mut FidoDevInfo,
    fido_dev_info_free: unsafe extern "C" fn(*mut *mut FidoDevInfo, usize),
    fido_dev_info_manifest: unsafe extern "C" fn(*mut FidoDevInfo, usize, *mut usize) -> c_int,
    fido_dev_info_ptr: unsafe extern "C" fn(*const FidoDevInfo, usize) -> *const FidoDevInfo,
    fido_dev_new_with_info: unsafe extern "C" fn(*const FidoDevInfo) -> *mut FidoDev,
    fido_dev_free: unsafe extern "C" fn(*mut *mut FidoDev),
    fido_dev_open_with_info: unsafe extern "C" fn(*mut FidoDev) -> c_int,
    fido_dev_close: unsafe extern "C" fn(*mut FidoDev) -> c_int,
    fido_dev_set_timeout: unsafe extern "C" fn(*mut FidoDev, c_int) -> c_int,
    fido_dev_is_fido2: unsafe extern "C" fn(*const FidoDev) -> bool,
    fido_dev_has_pin: unsafe extern "C" fn(*const FidoDev) -> bool,
    fido_dev_has_uv: unsafe extern "C" fn(*const FidoDev) -> bool,
    fido_dev_supports_cred_prot: unsafe extern "C" fn(*const FidoDev) -> bool,
    fido_dev_get_assert: unsafe extern "C" fn(*mut FidoDev, *mut FidoAssert, *const c_char) -> c_int,
    fido_assert_new: unsafe extern "C" fn() -> *mut FidoAssert,
    fido_assert_free: unsafe extern "C" fn(*mut *mut FidoAssert),
    fido_assert_set_rp: unsafe extern "C" fn(*mut FidoAssert, *const c_char) -> c_int,
    fido_assert_set_clientdata_hash: unsafe extern "C" fn(*mut FidoAssert, *const u8, usize) -> c_int,
    fido_assert_allow_cred: unsafe extern "C" fn(*mut FidoAssert, *const u8, usize) -> c_int,
    fido_assert_set_up: unsafe extern "C" fn(*mut FidoAssert, c_uint) -> c_int,
    fido_assert_set_uv: unsafe extern "C" fn(*mut FidoAssert, c_uint) -> c_int,
    fido_assert_count: unsafe extern "C" fn(*const FidoAssert) -> usize,
    fido_assert_id_len: unsafe extern "C" fn(*const FidoAssert, usize) -> usize,
    fido_assert_id_ptr: unsafe extern "C" fn(*const FidoAssert, usize) -> *const u8,
    fido_assert_sig_len: unsafe extern "C" fn(*const FidoAssert, usize) -> usize,
    fido_assert_sig_ptr: unsafe extern "C" fn(*const FidoAssert, usize) -> *const u8,
    fido_assert_flags: unsafe extern "C" fn(*const FidoAssert, usize) -> u8,
    fido_assert_sigcount: unsafe extern "C" fn(*const FidoAssert, usize) -> u32,
}

unsafe extern "C" fn discard_log(_: *const c_char) {}

fn failed(message: &str) -> DeviceError {
    DeviceError::Failed(message.to_owned())
}

fn status_failed(status: c_int, step: &str) -> DeviceError {
    DeviceError::Failed(format!("FIDO {step} failed (libfido2 status {status})."))
}

fn check(status: c_int, step: &str) -> Result<(), DeviceError> {
    if status == FIDO_OK {
        Ok(())
    } else {
        Err(status_failed(status, step))
    }
}

fn selection_timeout(start: Instant) -> Result<c_int, DeviceError> {
    let remaining = SELECTION_BUDGET.saturating_sub(start.elapsed()).as_millis();
    if remaining == 0 {
        return Err(failed("FIDO device selection timed out."));
    }
    Ok(remaining.min(PROBE_MS as u128) as c_int)
}

struct DeviceList<'a> {
    api: &'a Api,
    ptr: *mut FidoDevInfo,
    count: usize,
}

impl<'a> DeviceList<'a> {
    fn new(api: &'a Api) -> Result<Self, DeviceError> {
        // SAFETY: libfido2 owns the array layout; we pass the same capacity
        // to manifest and free, including on partial failure.
        let ptr = unsafe { (api.fido_dev_info_new)(MAX_DEVICES) };
        if ptr.is_null() {
            return Err(failed("Cannot allocate FIDO device list."));
        }
        let mut list = Self { api, ptr, count: 0 };
        check(
            unsafe { (api.fido_dev_info_manifest)(ptr, MAX_DEVICES, &mut list.count) },
            "device enumeration",
        )?;
        if list.count > MAX_DEVICES {
            return Err(failed("Invalid FIDO device list."));
        }
        Ok(list)
    }

    fn open(&self, index: usize, timeout: c_int) -> Result<Device<'a>, DeviceError> {
        if index >= self.count {
            return Err(failed("Invalid FIDO device index."));
        }
        // SAFETY: index is in the initialized portion of the live list. The
        // device constructor copies the info it needs, including the path.
        let ptr = unsafe {
            let info = (self.api.fido_dev_info_ptr)(self.ptr, index);
            if info.is_null() {
                return Err(failed("Invalid FIDO device entry."));
            }
            (self.api.fido_dev_new_with_info)(info)
        };
        if ptr.is_null() {
            return Err(failed("Cannot allocate FIDO device."));
        }
        let mut device = Device {
            api: self.api,
            ptr,
            opened: false,
        };
        device.set_timeout(timeout)?;
        // SAFETY: this is a fresh handle with its own manifest-supplied I/O.
        // libfido2 unwinds the native open on failure.
        check(
            unsafe { (self.api.fido_dev_open_with_info)(ptr) },
            "device open",
        )?;
        device.opened = true;
        Ok(device)
    }
}

impl Drop for DeviceList<'_> {
    fn drop(&mut self) {
        // SAFETY: exclusively owned allocation with its original capacity.
        unsafe { (self.api.fido_dev_info_free)(&mut self.ptr, MAX_DEVICES) };
    }
}

struct Device<'a> {
    api: &'a Api,
    ptr: *mut FidoDev,
    opened: bool,
}

impl Device<'_> {
    fn set_timeout(&mut self, ms: c_int) -> Result<(), DeviceError> {
        // SAFETY: the device handle is live and exclusively owned.
        check(
            unsafe { (self.api.fido_dev_set_timeout)(self.ptr, ms) },
            "timeout setup",
        )
    }

    fn get_assert(&mut self, assertion: &mut Request<'_>, pin: Option<&CStr>) -> c_int {
        // SAFETY: both live C objects are exclusive, and the optional PIN is
        // NUL-terminated and borrowed for just this synchronous call.
        unsafe {
            (self.api.fido_dev_get_assert)(
                self.ptr,
                assertion.ptr,
                pin.map_or(ptr::null(), CStr::as_ptr),
            )
        }
    }
}

impl Drop for Device<'_> {
    fn drop(&mut self) {
        // SAFETY: libfido2 requires a successful open to be paired with close;
        // fido_dev_free alone does not close it.
        unsafe {
            if self.opened {
                (self.api.fido_dev_close)(self.ptr);
            }
            (self.api.fido_dev_free)(&mut self.ptr);
        }
    }
}

struct Request<'a> {
    api: &'a Api,
    ptr: *mut FidoAssert,
}

impl<'a> Request<'a> {
    fn new(
        api: &'a Api,
        rp: &CStr,
        credential: &[u8],
        hash: &[u8; 32],
        up: bool,
        internal_uv: bool,
    ) -> Result<Self, DeviceError> {
        // SAFETY: setters copy the inputs into a fresh, exclusively owned
        // assertion. Request frees even a partially initialized assertion.
        unsafe {
            let ptr = (api.fido_assert_new)();
            if ptr.is_null() {
                return Err(failed("Cannot allocate FIDO assertion."));
            }
            let request = Self { api, ptr };
            check((api.fido_assert_set_rp)(ptr, rp.as_ptr()), "RP setup")?;
            check(
                (api.fido_assert_set_clientdata_hash)(ptr, hash.as_ptr(), hash.len()),
                "hash setup",
            )?;
            check(
                (api.fido_assert_allow_cred)(ptr, credential.as_ptr(), credential.len()),
                "allow-list setup",
            )?;
            let up = if up { FIDO_OPT_TRUE } else { FIDO_OPT_FALSE };
            check((api.fido_assert_set_up)(ptr, up), "presence setup")?;
            // Leave UV omitted for the default and for PIN auth. On CTAP2,
            // libfido2 adds pinUvAuthParam itself when a PIN is provided.
            if internal_uv {
                check(
                    (api.fido_assert_set_uv)(ptr, FIDO_OPT_TRUE),
                    "verification setup",
                )?;
            }
            Ok(request)
        }
    }

    fn signature(&self, credential: &[u8]) -> Result<&[u8], DeviceError> {
        // SAFETY: accessors borrow buffers owned by this live, immutable
        // request. Check count, lengths and nulls before making any slices.
        unsafe {
            let api = self.api;
            if (api.fido_assert_count)(self.ptr) != 1 {
                return Err(failed("Unexpected FIDO assertion count."));
            }
            let id_len = (api.fido_assert_id_len)(self.ptr, 0);
            // The ID may be omitted for a single allowed credential (also
            // absent on U2F). If returned, it must match the requested ID.
            if id_len != 0 {
                let id = (api.fido_assert_id_ptr)(self.ptr, 0);
                if id_len != credential.len()
                    || id.is_null()
                    || slice::from_raw_parts(id, id_len) != credential
                {
                    return Err(failed("FIDO returned the wrong credential."));
                }
            }
            let len = (api.fido_assert_sig_len)(self.ptr, 0);
            let sig = (api.fido_assert_sig_ptr)(self.ptr, 0);
            if !(1..=MAX_SIGNATURE_BYTES).contains(&len) || sig.is_null() {
                return Err(failed("Invalid FIDO signature length or buffer."));
            }
            Ok(slice::from_raw_parts(sig, len))
        }
    }

    fn finish(&self, credential: &[u8], required: u8) -> Result<Assertion, DeviceError> {
        let signature = self.signature(credential)?;
        // SAFETY: signature() established a live response with one record.
        let (flags, counter) = unsafe {
            (
                (self.api.fido_assert_flags)(self.ptr, 0),
                (self.api.fido_assert_sigcount)(self.ptr, 0),
            )
        };
        if flags & required != required {
            return Err(failed(
                "FIDO assertion did not satisfy presence or verification requirements.",
            ));
        }
        // libfido2 already returns the counter in host byte order.
        Ok(Assertion {
            signature: signature.to_vec(),
            flags,
            counter,
        })
    }
}

impl Drop for Request<'_> {
    fn drop(&mut self) {
        // SAFETY: the assertion is exclusively owned and was allocated by Api.
        unsafe { (self.api.fido_assert_free)(&mut self.ptr) };
    }
}

pub(super) fn sign(
    key: &KeyHandle,
    client_data_hash: &[u8; 32],
    get_pin: impl FnOnce() -> Result<zeroize::Zeroizing<Vec<u8>>, DeviceError>,
) -> Result<Assertion, DeviceError> {
    let credential = key.credential_id.as_slice();
    if !(1..=MAX_APPLICATION_BYTES).contains(&key.application.len())
        || !(1..=MAX_CREDENTIAL_BYTES).contains(&credential.len())
    {
        return Err(failed("Invalid FIDO application or credential length."));
    }
    let rp = CString::new(key.application.as_bytes())
        .map_err(|_| failed("Invalid FIDO application."))?;
    let api = Api::load()?;
    // SAFETY: initialize on this thread before any device operation. Keep
    // native CTAP1 support, but do not downgrade when CTAP2 GetInfo fails.
    // fido_init also honors FIDO_DEBUG; discard diagnostics before any I/O.
    unsafe {
        (api.fido_init)(FIDO_DISABLE_U2F_FALLBACK);
        (api.fido_set_log_handler)(discard_log);
    }

    let start = Instant::now();
    let devices = DeviceList::new(&api)?;
    if devices.count == 0 {
        return Err(failed("No accessible FIDO devices found. Check that the key is connected and Linux device permissions allow access."));
    }
    let wants_uv = key.flags & USER_VERIFICATION != 0;
    let mut opened_any = false;
    let mut probe_needs_uv = false;
    for index in 0..devices.count {
        let Ok(mut device) = devices.open(index, selection_timeout(start)?) else {
            continue;
        };
        opened_any = true;
        // SAFETY: these read capability bits cached on the open handle.
        let (fido2, has_pin, has_uv, cred_protect) = unsafe {
            (
                (api.fido_dev_is_fido2)(device.ptr),
                (api.fido_dev_has_pin)(device.ptr),
                (api.fido_dev_has_uv)(device.ptr),
                (api.fido_dev_supports_cred_prot)(device.ptr),
            )
        };
        // Like OpenSSH sk_try: one allow-listed credential, UP=false, no
        // PIN, and a dummy hash whose signature is never used for SSH.
        let mut probe = Request::new(&api, &rp, credential, &[0; 32], false, false)?;
        device.set_timeout(selection_timeout(start)?)?;
        let ambiguous = match device.get_assert(&mut probe, None) {
            FIDO_OK if probe.signature(credential).is_ok() => false,
            FIDO_ERR_USER_PRESENCE_REQUIRED if !fido2 => false, // U2F check-only matched
            FIDO_ERR_PIN_REQUIRED if fido2 && (has_pin || has_uv) => true,
            // A UV-protected credential can be hidden from silent probes.
            // Only consider this for keys that request UV and devices that
            // advertise credential protection; it is not evidence of a match.
            FIDO_ERR_NO_CREDENTIALS if fido2 && wants_uv && cred_protect && (has_pin || has_uv) => {
                true
            }
            _ => continue,
        };
        drop(probe);
        selection_timeout(start)?;
        if ambiguous && devices.count != 1 {
            probe_needs_uv = true;
            continue;
        }

        // Keep the selected handle open. Never try another device once we
        // reach a real assertion, including after an invalid PIN or timeout.
        // A PIN/UV-gated probe is ambiguous (e.g. alwaysUv); the sole-device
        // fallback can still be the wrong key. Unplug other keys before retrying.
        let verify = wants_uv || ambiguous;
        // Jammy's U2F path treats UP=false as check-only, not a signature.
        let up = key.flags & USER_PRESENCE != 0 || !fido2;
        device.set_timeout(SIGN_MS)?;
        let mut assert = |pin: Option<&CStr>| {
            let verified = verify || pin.is_some();
            let required = (if up { USER_PRESENCE } else { 0 })
                | (if verified { USER_VERIFICATION } else { 0 });
            let mut assertion = Request::new(
                &api,
                &rp,
                credential,
                client_data_hash,
                up,
                verified && pin.is_none(),
            )?;
            match device.get_assert(&mut assertion, pin) {
                FIDO_OK => assertion.finish(credential, required),
                FIDO_ERR_PIN_REQUIRED | FIDO_ERR_UV_BLOCKED | FIDO_ERR_UV_INVALID
                    if pin.is_none() && has_pin =>
                {
                    Err(DeviceError::PinRequired)
                }
                FIDO_ERR_PIN_INVALID => Err(failed("The FIDO device rejected the PIN.")),
                FIDO_ERR_PIN_BLOCKED | FIDO_ERR_PIN_AUTH_BLOCKED => {
                    Err(failed("The FIDO device has blocked PIN authentication."))
                }
                status => Err(status_failed(status, "assertion")),
            }
        };
        let result = if verify && !has_uv {
            if !has_pin {
                return Err(failed(
                    "The selected FIDO device has no configured user verification.",
                ));
            }
            Err(DeviceError::PinRequired)
        } else {
            assert(None)
        };
        return match result {
            Err(DeviceError::PinRequired) => {
                // Keep the same open handle while the local dialog is active.
                // A hotplug or re-enumeration must not redirect the PIN.
                let pin = get_pin()?;
                let pin = CStr::from_bytes_with_nul(&pin)
                    .map_err(|_| failed("Invalid FIDO PIN format."))?;
                assert(Some(pin))
            }
            result => result,
        };
    }
    if !opened_any {
        Err(failed("Cannot open a FIDO device. Check Linux device permissions and whether another application is using the key."))
    } else if probe_needs_uv {
        Err(failed("Cannot identify the PIN/UV-protected FIDO credential. Connect only the intended key and retry."))
    } else {
        Err(failed(
            "No matching FIDO credential found on the probed devices.",
        ))
    }
}

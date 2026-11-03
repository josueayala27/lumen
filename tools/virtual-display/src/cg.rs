//! Public CoreGraphics display queries and the `--list` report.

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use objc2_foundation::{NSDictionary, NSNumber, NSRect, NSString};

pub type DisplayId = u32;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut DisplayId, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: DisplayId) -> NSRect;
    fn CGDisplayCopyDisplayMode(display: DisplayId) -> *mut c_void;
    fn CGDisplayCopyAllDisplayModes(display: DisplayId, options: *const c_void) -> *const c_void;
    fn CGDisplayModeGetWidth(mode: *const c_void) -> usize;
    fn CGDisplayModeGetHeight(mode: *const c_void) -> usize;
    fn CGDisplayModeGetPixelWidth(mode: *const c_void) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: *const c_void) -> usize;
    fn CGDisplayModeGetRefreshRate(mode: *const c_void) -> f64;
    fn CGBeginDisplayConfiguration(config: *mut *mut c_void) -> i32;
    fn CGConfigureDisplayWithDisplayMode(
        config: *mut c_void,
        display: DisplayId,
        mode: *const c_void,
        options: *const c_void,
    ) -> i32;
    fn CGCompleteDisplayConfiguration(config: *mut c_void, option: u32) -> i32;
    fn CGCancelDisplayConfiguration(config: *mut c_void) -> i32;
    fn CGDisplayVendorNumber(display: DisplayId) -> u32;
    fn CGDisplayModelNumber(display: DisplayId) -> u32;
    fn CGDisplaySerialNumber(display: DisplayId) -> u32;
    fn CGDisplayIsMain(display: DisplayId) -> u32;
    pub fn CGPreflightScreenCaptureAccess() -> bool;
    pub fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    pub fn CFRetain(object: *const c_void) -> *const c_void;
    pub fn CFRelease(object: *const c_void);
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
}

/// `kCGConfigureForAppOnly`: the mode change reverts when this process exits.
const CONFIGURE_FOR_APP_ONLY: u32 = 0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mode {
    pub width: usize,
    pub height: usize,
    pub pixel_width: usize,
    pub pixel_height: usize,
    pub hz: f64,
}

fn read_mode(mode: *const c_void) -> Mode {
    // SAFETY: `mode` is a valid CGDisplayModeRef.
    unsafe {
        Mode {
            width: CGDisplayModeGetWidth(mode),
            height: CGDisplayModeGetHeight(mode),
            pixel_width: CGDisplayModeGetPixelWidth(mode),
            pixel_height: CGDisplayModeGetPixelHeight(mode),
            hz: CGDisplayModeGetRefreshRate(mode),
        }
    }
}

pub fn current_mode(id: DisplayId) -> Option<Mode> {
    // SAFETY: copy rule: we own the returned mode and release it.
    unsafe {
        let mode = CGDisplayCopyDisplayMode(id);
        if mode.is_null() {
            return None;
        }
        let info = read_mode(mode);
        CFRelease(mode);
        Some(info)
    }
}

/// Switches a display to the mode with this size in points and pixels. macOS restores the
/// last mode it saw for a display's vendor/product/serial, which may not be the one asked
/// for. `Ok(None)` means the display has not published its modes yet; try again shortly.
pub fn select_mode(
    id: DisplayId,
    width: usize,
    height: usize,
    scale: usize,
    hz: f64,
) -> Result<Option<Mode>, String> {
    let wanted = |mode: &Mode| {
        mode.width == width && mode.height == height && mode.pixel_width == width * scale
    };
    if let Some(mode) = current_mode(id).filter(wanted) {
        return Ok(Some(mode));
    }
    // HiDPI modes are only listed with kCGDisplayShowDuplicateLowResolutionModes.
    let key = NSString::from_str("kCGDisplayShowDuplicateLowResolutionModes");
    let yes = NSNumber::new_bool(true);
    let options = NSDictionary::from_slices(&[&*key], &[&*yes]);
    let options = (&raw const *options).cast::<c_void>();
    // SAFETY: copy rule for the array; modes are borrowed from it while it is alive.
    unsafe {
        let modes = CGDisplayCopyAllDisplayModes(id, options);
        if modes.is_null() {
            return Ok(None);
        }
        let found = (0..CFArrayGetCount(modes))
            .map(|index| CFArrayGetValueAtIndex(modes, index))
            .filter(|mode| wanted(&read_mode(*mode)))
            .min_by(|a, b| {
                let off = |mode: &*const c_void| (read_mode(*mode).hz - hz).abs();
                off(a).total_cmp(&off(b))
            });
        let result = match found {
            None => Err(format!(
                "display {id} has no {width}x{height} mode at {scale}x; it keeps {:?}",
                current_mode(id)
            )),
            Some(mode) => {
                let mut config = std::ptr::null_mut();
                if CGBeginDisplayConfiguration(&mut config) != 0 {
                    Err("CGBeginDisplayConfiguration failed".into())
                } else if CGConfigureDisplayWithDisplayMode(config, id, mode, std::ptr::null()) != 0
                {
                    CGCancelDisplayConfiguration(config);
                    Err(format!("cannot switch display {id} to {width}x{height}"))
                } else if CGCompleteDisplayConfiguration(config, CONFIGURE_FOR_APP_ONLY) != 0 {
                    Err(format!(
                        "cannot apply the {width}x{height} mode to display {id}"
                    ))
                } else {
                    Ok(Some(read_mode(mode)))
                }
            }
        };
        CFRelease(modes);
        result
    }
}

pub fn active_displays() -> Vec<DisplayId> {
    let mut ids = [0u32; 32];
    let mut count = 0u32;
    // SAFETY: the buffer holds `ids.len()` entries and CoreGraphics writes at most that many.
    let status = unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
    if status != 0 {
        return Vec::new();
    }
    ids[..count as usize].to_vec()
}

pub struct DisplaySummary {
    pub id: DisplayId,
    pub bounds: NSRect,
    pub mode: Option<Mode>,
    pub vendor: u32,
    pub model: u32,
    pub serial: u32,
    pub main: bool,
}

pub fn summary(id: DisplayId) -> DisplaySummary {
    // SAFETY: plain CoreGraphics queries; an unknown id returns zeros.
    unsafe {
        DisplaySummary {
            id,
            bounds: CGDisplayBounds(id),
            mode: current_mode(id),
            vendor: CGDisplayVendorNumber(id),
            model: CGDisplayModelNumber(id),
            serial: CGDisplaySerialNumber(id),
            main: CGDisplayIsMain(id) != 0,
        }
    }
}

/// `NSScreen.localizedName` for a display id, if AppKit knows the screen.
pub fn screen_name(mtm: MainThreadMarker, id: DisplayId) -> Option<String> {
    let key = NSString::from_str("NSScreenNumber");
    NSScreen::screens(mtm).iter().find_map(|screen| {
        let description = screen.deviceDescription();
        let number: Retained<AnyObject> = description.objectForKey(&key)?;
        let number = number.downcast::<NSNumber>().ok()?;
        (number.unsignedIntValue() == id).then(|| screen.localizedName().to_string())
    })
}

pub fn screen_count(mtm: MainThreadMarker) -> usize {
    NSScreen::screens(mtm).count()
}

pub fn describe(mtm: MainThreadMarker, id: DisplayId) -> String {
    let info = summary(id);
    let name = screen_name(mtm, id).unwrap_or_else(|| "?".into());
    let mode = info.mode.unwrap_or(Mode {
        width: 0,
        height: 0,
        pixel_width: 0,
        pixel_height: 0,
        hz: 0.0,
    });
    format!(
        "id={} name={:?} origin=({}, {}) size={}x{} pt pixels={}x{} @{}Hz vendor={:#06x} model={} serial={}{}",
        info.id,
        name,
        info.bounds.origin.x,
        info.bounds.origin.y,
        info.bounds.size.width,
        info.bounds.size.height,
        mode.pixel_width,
        mode.pixel_height,
        mode.hz,
        info.vendor,
        info.model,
        info.serial,
        if info.main { " main" } else { "" },
    )
}

pub fn print_list(mtm: MainThreadMarker) {
    use std::io::Write;
    let ids = active_displays();
    let mut out = std::io::stdout().lock();
    // Write errors (for example a closed pipe from `| head`) are ignored on purpose.
    let _ = writeln!(
        out,
        "{} active display(s), {} NSScreen(s):",
        ids.len(),
        screen_count(mtm)
    );
    for id in ids {
        let _ = writeln!(out, "  {}", describe(mtm, id));
    }
    // Tao (and so Lumen's list_displays) names macOS monitors "Monitor #<model number>".
    let _ = writeln!(out, "Lumen/tao names each display \"Monitor #<model>\".");
}

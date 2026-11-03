//! `--mirror`: a small window per virtual display that shows its content.
//!
//! Uses ScreenCaptureKit (`SCShareableContent` to find the display, then
//! `SCScreenshotManager` about ten times a second). `CGDisplayStream` is obsolete since
//! macOS 15, so it is not an option. Needs Screen Recording permission for the process
//! that runs the tool (usually the terminal app).

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSBackingStoreType, NSColor, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};

use crate::cg::{self, DisplayId};

#[link(name = "ScreenCaptureKit", kind = "framework")]
extern "C" {}

const FRAME_INTERVAL: Duration = Duration::from_millis(100);
const PREVIEW_WIDTH: f64 = 480.0;

/// An Objective-C object handed from a completion handler to the main thread.
struct SendObject(Retained<AnyObject>);
// SAFETY: ScreenCaptureKit result objects are immutable value objects; the main thread
// only reads them after the handler has finished with them.
unsafe impl Send for SendObject {}

#[derive(Default)]
struct Shared {
    display: Mutex<Option<SendObject>>,
    /// A retained `CGImageRef`, stored as an address.
    image: Mutex<Option<usize>>,
    error: Mutex<Option<String>>,
    in_flight: AtomicBool,
}

pub struct Mirror {
    id: DisplayId,
    window: Retained<NSWindow>,
    layer: Retained<AnyObject>,
    shared: Arc<Shared>,
    filter: Option<Retained<AnyObject>>,
    config: Option<Retained<AnyObject>>,
    last_capture: Instant,
    failed: bool,
    shown_first_frame: bool,
}

/// Checks Screen Recording permission and asks for it once if missing.
pub fn check_permission() {
    // SAFETY: plain CoreGraphics calls.
    if unsafe { cg::CGPreflightScreenCaptureAccess() } {
        return;
    }
    eprintln!(
        "--mirror: Screen Recording permission is missing. macOS asks for it now; allow the \
         app that runs this tool (Terminal, iTerm, VS Code, ...) in System Settings > Privacy \
         & Security > Screen & System Audio Recording, then restart that app. The virtual \
         displays work without it; only the mirror window stays black."
    );
    // SAFETY: plain CoreGraphics call; shows the system prompt at most once.
    unsafe { cg::CGRequestScreenCaptureAccess() };
}

fn sck_class(name: &std::ffi::CStr) -> Result<&'static AnyClass, String> {
    AnyClass::get(name).ok_or_else(|| {
        format!(
            "--mirror needs ScreenCaptureKit's {} (macOS 14+)",
            name.to_string_lossy()
        )
    })
}

fn error_text(error: *mut AnyObject) -> String {
    if error.is_null() {
        return "unknown error".into();
    }
    // SAFETY: a non-null NSError from a ScreenCaptureKit completion handler.
    unsafe {
        let text: Retained<NSString> = msg_send![error, localizedDescription];
        let code: isize = msg_send![error, code];
        format!("{text} (code {code})")
    }
}

impl Mirror {
    pub fn open(
        mtm: MainThreadMarker,
        id: DisplayId,
        title: &str,
        aspect: f64,
        slot: usize,
    ) -> Result<Self, String> {
        sck_class(c"SCScreenshotManager")?;
        let content_class = sck_class(c"SCShareableContent")?;

        let height = (PREVIEW_WIDTH / aspect).round();
        let origin = NSPoint::new(40.0 + slot as f64 * (PREVIEW_WIDTH + 20.0), 80.0);
        let rect = NSRect::new(origin, NSSize::new(PREVIEW_WIDTH, height));
        let style = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable;
        // SAFETY: standard AppKit window creation on the main thread.
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                rect,
                style,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        // SAFETY: we own the window and keep it alive; AppKit must not free it on close.
        unsafe { window.setReleasedWhenClosed(false) };
        window.setTitle(&NSString::from_str(&format!("Mirror: {title} (id {id})")));
        window.setBackgroundColor(Some(&NSColor::blackColor()));
        window.setContentAspectRatio(NSSize::new(aspect, 1.0));
        let view = window
            .contentView()
            .ok_or("mirror window has no content view")?;
        view.setWantsLayer(true);
        // SAFETY: a layer-backed view always has a CALayer; the gravity is a CALayer constant.
        let layer: Retained<AnyObject> = unsafe {
            let layer: Option<Retained<AnyObject>> = msg_send![&*view, layer];
            let layer = layer.ok_or("mirror view has no layer")?;
            let gravity = NSString::from_str("resizeAspect");
            let _: () = msg_send![&*layer, setContentsGravity: &*gravity];
            layer
        };
        window.orderFrontRegardless();

        let shared = Arc::new(Shared::default());
        let handler_shared = Arc::clone(&shared);
        let handler = RcBlock::new(move |content: *mut AnyObject, error: *mut AnyObject| {
            if content.is_null() {
                *handler_shared.error.lock().unwrap() = Some(error_text(error));
                return;
            }
            // SAFETY: `content` is an SCShareableContent; `displays` holds SCDisplay objects.
            let found = unsafe {
                let displays: Retained<NSArray<AnyObject>> = msg_send![content, displays];
                displays.iter().find(|display| {
                    let display_id: u32 = msg_send![&**display, displayID];
                    display_id == id
                })
            };
            match found {
                Some(display) => {
                    *handler_shared.display.lock().unwrap() = Some(SendObject(display));
                }
                None => {
                    *handler_shared.error.lock().unwrap() =
                        Some(format!("ScreenCaptureKit does not list display {id}"));
                }
            }
        });
        // SAFETY: class method with a `(SCShareableContent *, NSError *)` completion block.
        unsafe {
            let _: () =
                msg_send![content_class, getShareableContentWithCompletionHandler: &*handler];
        }

        Ok(Self {
            id,
            window,
            layer,
            shared,
            filter: None,
            config: None,
            last_capture: Instant::now(),
            failed: false,
            shown_first_frame: false,
        })
    }

    /// Called from the main loop: sets up the filter, starts captures, shows new frames.
    pub fn tick(&mut self) {
        if self.failed {
            return;
        }
        if let Some(error) = self.shared.error.lock().unwrap().take() {
            eprintln!(
                "--mirror: display {} cannot be captured: {error}. If this is a permission \
                 error, grant Screen Recording to the app running this tool and restart it.",
                self.id
            );
            self.failed = true;
            return;
        }
        if self.filter.is_none() {
            let Some(SendObject(display)) = self.shared.display.lock().unwrap().take() else {
                return;
            };
            match self.make_filter(&display) {
                Ok((filter, config)) => {
                    self.filter = Some(filter);
                    self.config = Some(config);
                }
                Err(error) => {
                    eprintln!("--mirror: {error}");
                    self.failed = true;
                    return;
                }
            }
        }
        if let Some(address) = self.shared.image.lock().unwrap().take() {
            let image = address as *mut AnyObject;
            // SAFETY: `image` is a CGImageRef we retained in the capture handler; CALayer
            // retains its contents, so we release ours afterwards.
            unsafe {
                let _: () = msg_send![&*self.layer, setContents: image];
                cg::CFRelease(image as *const c_void);
            }
            if !self.shown_first_frame {
                self.shown_first_frame = true;
                println!("--mirror: showing display {}", self.id);
            }
        }
        if self.last_capture.elapsed() >= FRAME_INTERVAL
            && !self.shared.in_flight.swap(true, Ordering::AcqRel)
        {
            self.last_capture = Instant::now();
            self.capture();
        }
    }

    fn make_filter(
        &self,
        display: &AnyObject,
    ) -> Result<(Retained<AnyObject>, Retained<AnyObject>), String> {
        let filter_class = sck_class(c"SCContentFilter")?;
        let config_class = sck_class(c"SCStreamConfiguration")?;
        // SAFETY: documented ScreenCaptureKit initialisers and setters.
        unsafe {
            let pixel_width: usize = msg_send![display, width];
            let pixel_height: usize = msg_send![display, height];
            let excluded = NSArray::<AnyObject>::new();
            let allocated: Allocated<AnyObject> = msg_send![filter_class, alloc];
            let filter: Retained<AnyObject> =
                msg_send![allocated, initWithDisplay: display, excludingWindows: &*excluded];
            let config: Retained<AnyObject> = msg_send![config_class, new];
            let width = (PREVIEW_WIDTH as usize * 2).min(pixel_width.max(1));
            let height = (width * pixel_height / pixel_width.max(1)).max(1);
            let _: () = msg_send![&*config, setWidth: width];
            let _: () = msg_send![&*config, setHeight: height];
            let _: () = msg_send![&*config, setShowsCursor: Bool::YES];
            Ok((filter, config))
        }
    }

    fn capture(&self) {
        let (Some(filter), Some(config)) = (&self.filter, &self.config) else {
            self.shared.in_flight.store(false, Ordering::Release);
            return;
        };
        let Some(manager) = AnyClass::get(c"SCScreenshotManager") else {
            return;
        };
        let shared = Arc::clone(&self.shared);
        let handler = RcBlock::new(move |image: *mut c_void, error: *mut AnyObject| {
            if image.is_null() {
                *shared.error.lock().unwrap() = Some(error_text(error));
            } else {
                // SAFETY: the handler only borrows the image; retain it for the main thread.
                unsafe { cg::CFRetain(image) };
                if let Some(old) = shared.image.lock().unwrap().replace(image as usize) {
                    // SAFETY: a frame the main thread never picked up.
                    unsafe { cg::CFRelease(old as *const c_void) };
                }
            }
            shared.in_flight.store(false, Ordering::Release);
        });
        // SAFETY: class method with a `(CGImageRef, NSError *)` completion block.
        unsafe {
            let _: () = msg_send![
                manager,
                captureImageWithFilter: &**filter,
                configuration: &**config,
                completionHandler: &*handler
            ];
        }
    }
}

impl Drop for Mirror {
    fn drop(&mut self) {
        self.window.close();
        if let Some(address) = self.shared.image.lock().unwrap().take() {
            // SAFETY: a retained frame nobody displayed.
            unsafe { cg::CFRelease(address as *const c_void) };
        }
    }
}

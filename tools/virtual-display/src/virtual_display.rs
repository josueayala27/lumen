//! The private `CGVirtualDisplay` SPI (CoreGraphics, macOS 11+), looked up at runtime.
//!
//! Interface, as used by DeskPad and BetterDisplay:
//!
//! ```objc
//! @interface CGVirtualDisplayDescriptor : NSObject
//! @property(retain) dispatch_queue_t queue;
//! @property(retain) NSString *name;
//! @property unsigned int maxPixelsWide, maxPixelsHigh;
//! @property CGSize sizeInMillimeters;
//! @property unsigned int vendorID, productID, serialNum;
//! @property(copy) void (^terminationHandler)(id, CGVirtualDisplay *);
//! @end
//! @interface CGVirtualDisplayMode : NSObject
//! - (instancetype)initWithWidth:(unsigned int)w height:(unsigned int)h refreshRate:(double)hz;
//! @end
//! @interface CGVirtualDisplaySettings : NSObject
//! @property(retain) NSArray<CGVirtualDisplayMode *> *modes;
//! @property unsigned int hiDPI;
//! @end
//! @interface CGVirtualDisplay : NSObject
//! - (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
//! @property(readonly) CGDirectDisplayID displayID;
//! - (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
//! @end
//! ```

use std::ffi::CStr;

use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSArray, NSSize, NSString};

use crate::cg::DisplayId;

/// Stable identity. Lumen matches screens by name and position, and tao names macOS
/// monitors "Monitor #<productID>", so these must not change between runs.
pub const VENDOR_ID: u32 = 0x4c4d; // "LM"
pub const PRODUCT_ID_BASE: u32 = 0x4c56; // "LV"; display N gets PRODUCT_ID_BASE + N
pub const SERIAL_BASE: u32 = 0x4c00_0001;
/// macOS remembers per display (vendor/product/serial) whether it runs HiDPI and ignores
/// later `hiDPI` settings, so HiDPI displays use their own serial range.
pub const HIDPI_SERIAL_OFFSET: u32 = 0x100;

/// Pixel density used to derive a plausible physical size (about a 24" 1080p monitor).
const POINTS_PER_INCH: f64 = 92.0;

#[derive(Debug, Clone)]
pub struct Spec {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub hz: f64,
    pub hidpi: bool,
    pub index: u32,
}

/// Dropping it releases the last reference, which removes the display from WindowServer.
pub struct VirtualDisplay {
    _object: Retained<AnyObject>,
    pub id: DisplayId,
    pub spec: Spec,
}

extern "C" {
    // `dispatch_get_main_queue()` is a macro over this symbol (libdispatch, in libSystem).
    static _dispatch_main_q: u8;
}

fn class(name: &CStr) -> Result<&'static AnyClass, String> {
    AnyClass::get(name).ok_or_else(|| {
        format!(
            "private class {} is missing. This macOS version no longer ships the \
             CGVirtualDisplay SPI this tool relies on.",
            name.to_string_lossy()
        )
    })
}

pub fn create(spec: Spec) -> Result<VirtualDisplay, String> {
    let descriptor_class = class(c"CGVirtualDisplayDescriptor")?;
    let display_class = class(c"CGVirtualDisplay")?;
    let settings_class = class(c"CGVirtualDisplaySettings")?;
    let mode_class = class(c"CGVirtualDisplayMode")?;

    let scale = if spec.hidpi { 2 } else { 1 };
    let millimeters = NSSize::new(
        f64::from(spec.width) / POINTS_PER_INCH * 25.4,
        f64::from(spec.height) / POINTS_PER_INCH * 25.4,
    );

    // SAFETY: selectors and argument types follow the interface in the module docs.
    // objc2 verifies argument encodings against the runtime in debug builds.
    unsafe {
        let descriptor: Retained<AnyObject> = msg_send![descriptor_class, new];
        let main_queue = (&raw const _dispatch_main_q) as *mut AnyObject;
        let _: () = msg_send![&*descriptor, setQueue: main_queue];
        let name = NSString::from_str(&spec.name);
        let _: () = msg_send![&*descriptor, setName: &*name];
        let _: () = msg_send![&*descriptor, setMaxPixelsWide: spec.width * scale];
        let _: () = msg_send![&*descriptor, setMaxPixelsHigh: spec.height * scale];
        let _: () = msg_send![&*descriptor, setSizeInMillimeters: millimeters];
        let _: () = msg_send![&*descriptor, setVendorID: VENDOR_ID];
        let _: () = msg_send![&*descriptor, setProductID: PRODUCT_ID_BASE + spec.index];
        let _: () = msg_send![&*descriptor, setSerialNum: serial(&spec)];
        let label = spec.name.clone();
        let terminated = RcBlock::new(move |_: *mut AnyObject, _: *mut AnyObject| {
            eprintln!("virtual display {label:?} was terminated by the system");
        });
        let _: () = msg_send![&*descriptor, setTerminationHandler: &*terminated];

        let allocated: Allocated<AnyObject> = msg_send![display_class, alloc];
        let object: Option<Retained<AnyObject>> =
            msg_send![allocated, initWithDescriptor: &*descriptor];
        let object = object.ok_or("CGVirtualDisplay initWithDescriptor: returned nil")?;
        let id: u32 = msg_send![&*object, displayID];
        if id == 0 {
            return Err("CGVirtualDisplay was created without a display id".into());
        }

        let allocated: Allocated<AnyObject> = msg_send![mode_class, alloc];
        let mode: Retained<AnyObject> = msg_send![
            allocated,
            initWithWidth: spec.width,
            height: spec.height,
            refreshRate: spec.hz
        ];
        let modes = NSArray::from_retained_slice(&[mode]);
        let settings: Retained<AnyObject> = msg_send![settings_class, new];
        let _: () = msg_send![&*settings, setModes: &*modes];
        let _: () = msg_send![&*settings, setHiDPI: u32::from(spec.hidpi)];
        let applied: Bool = msg_send![&*object, applySettings: &*settings];
        if !applied.as_bool() {
            return Err(format!("applySettings: failed for display {id}"));
        }

        Ok(VirtualDisplay {
            _object: object,
            id,
            spec,
        })
    }
}

/// Stable serial for a display slot; HiDPI and 1x displays never share one.
pub fn serial(spec: &Spec) -> u32 {
    let offset = if spec.hidpi { HIDPI_SERIAL_OFFSET } else { 0 };
    SERIAL_BASE + offset + spec.index
}

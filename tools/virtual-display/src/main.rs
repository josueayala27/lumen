//! Dev-only tool: creates macOS virtual displays so Lumen's native audience outputs can
//! be tested on a single-screen Mac. Uses the private `CGVirtualDisplay` SPI.

mod cli;

#[cfg(target_os = "macos")]
mod cg;
#[cfg(target_os = "macos")]
mod mirror;
#[cfg(target_os = "macos")]
mod virtual_display;

use std::process::ExitCode;

fn main() -> ExitCode {
    let options = match cli::parse(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("error: {error}\n\n{}", cli::USAGE);
            return ExitCode::from(2);
        }
    };
    if options.help {
        println!("{}", cli::USAGE);
        return ExitCode::SUCCESS;
    }
    run(options)
}

#[cfg(not(target_os = "macos"))]
fn run(_: cli::Options) -> ExitCode {
    eprintln!("error: lumen-virtual-display only runs on macOS");
    ExitCode::FAILURE
}

#[cfg(target_os = "macos")]
fn run(options: cli::Options) -> ExitCode {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSEventMask};
    use objc2_foundation::{NSDate, NSDefaultRunLoopMode};

    static STOP: AtomicBool = AtomicBool::new(false);

    extern "C" fn on_signal(_: libc::c_int) {
        STOP.store(true, Ordering::SeqCst);
    }

    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("error: must run on the main thread");
        return ExitCode::FAILURE;
    };
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    app.finishLaunching();

    // Runs the main run loop (and so the main dispatch queue) and AppKit events.
    let pump = |duration: Duration, mirrors: &mut [mirror::Mirror]| {
        let until = Instant::now() + duration;
        loop {
            let date = NSDate::dateWithTimeIntervalSinceNow(0.02);
            // SAFETY: `NSDefaultRunLoopMode` is an immutable framework constant.
            let mode = unsafe { NSDefaultRunLoopMode };
            if let Some(event) = app.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&date),
                mode,
                true,
            ) {
                app.sendEvent(&event);
            }
            for mirror in mirrors.iter_mut() {
                mirror.tick();
            }
            if STOP.load(Ordering::SeqCst) || Instant::now() >= until {
                break;
            }
        }
    };

    if options.list {
        pump(Duration::from_millis(100), &mut []);
        cg::print_list(mtm);
        return ExitCode::SUCCESS;
    }

    // SAFETY: the handler only stores to an atomic, which is async-signal-safe.
    unsafe {
        libc::signal(
            libc::SIGINT,
            on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
        );
        libc::signal(
            libc::SIGTERM,
            on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
        );
    }

    let mut displays = Vec::new();
    for index in 0..options.count {
        let name = if index == 0 {
            options.name.clone()
        } else {
            format!("{} {}", options.name, index + 1)
        };
        let spec = virtual_display::Spec {
            name,
            width: options.width,
            height: options.height,
            hz: options.hz,
            hidpi: options.hidpi,
            index,
        };
        match virtual_display::create(spec) {
            Ok(display) => displays.push(display),
            Err(error) => {
                eprintln!("error: {error}");
                return ExitCode::FAILURE;
            }
        }
    }

    // WindowServer configures the new displays asynchronously.
    let ids: Vec<u32> = displays.iter().map(|display| display.id).collect();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && !ids.iter().all(|id| cg::active_displays().contains(id)) {
        pump(Duration::from_millis(100), &mut []);
    }
    for display in &displays {
        let spec = &display.spec;
        let scale = if spec.hidpi { 2 } else { 1 };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match cg::select_mode(
                display.id,
                spec.width as usize,
                spec.height as usize,
                scale,
                spec.hz,
            ) {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => pump(Duration::from_millis(100), &mut []),
                Ok(None) => {
                    eprintln!("warning: display {} published no modes", display.id);
                    break;
                }
                Err(error) => {
                    eprintln!("warning: {error}");
                    break;
                }
            }
        }
    }
    pump(Duration::from_millis(300), &mut []);

    for display in &displays {
        let spec = &display.spec;
        println!(
            "created {:?}: {}x{}@{}Hz{}",
            spec.name,
            spec.width,
            spec.height,
            spec.hz,
            if spec.hidpi { " HiDPI" } else { "" }
        );
        if cg::active_displays().contains(&display.id) {
            println!("  {}", cg::describe(mtm, display.id));
        } else {
            println!("  id={} (not active yet)", display.id);
        }
    }

    let mut mirrors = Vec::new();
    if options.mirror {
        mirror::check_permission();
        let aspect = f64::from(options.width) / f64::from(options.height);
        for (slot, display) in displays.iter().enumerate() {
            match mirror::Mirror::open(mtm, display.id, &display.spec.name, aspect, slot) {
                Ok(mirror) => mirrors.push(mirror),
                Err(error) => eprintln!("--mirror: {error}"),
            }
        }
    }

    println!("Running. Press Ctrl+C to remove the virtual display(s).");
    while !STOP.load(Ordering::SeqCst) {
        pump(Duration::from_millis(250), &mut mirrors);
    }

    drop(mirrors);
    drop(displays);
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && ids.iter().any(|id| cg::active_displays().contains(id)) {
        pump(Duration::from_millis(100), &mut []);
    }
    let left: Vec<u32> = ids
        .iter()
        .copied()
        .filter(|id| cg::active_displays().contains(id))
        .collect();
    if left.is_empty() {
        println!("Removed virtual display(s) {ids:?}.");
        ExitCode::SUCCESS
    } else {
        eprintln!("warning: display(s) {left:?} still active after release");
        ExitCode::FAILURE
    }
}

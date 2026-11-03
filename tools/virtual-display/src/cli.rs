//! Hand-rolled argument parsing, so the tool has no CLI dependency.

pub const USAGE: &str = "\
lumen-virtual-display: create macOS virtual displays for testing Lumen outputs

USAGE:
    lumen-virtual-display [OPTIONS]

OPTIONS:
    --width <px>      Mode width in points (default 1920)
    --height <px>     Mode height in points (default 1080)
    --hz <rate>       Refresh rate (default 60)
    --name <name>     Display name (default \"Lumen Virtual Display\"); with --count,
                      displays after the first get \" 2\", \" 3\", ... appended
    --hidpi           Retina mode: backing store is 2x the mode size
    --count <n>       Number of displays to create (default 1, max 8)
    --mirror          Open a window per display that shows its content scaled down
                      (ScreenCaptureKit, needs Screen Recording permission)
    --list            Print the active displays and exit
    -h, --help        Print this help

The displays stay until Ctrl+C (or SIGTERM).";

#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    pub width: u32,
    pub height: u32,
    pub hz: f64,
    pub name: String,
    pub hidpi: bool,
    pub count: u32,
    pub mirror: bool,
    pub list: bool,
    pub help: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            hz: 60.0,
            name: "Lumen Virtual Display".into(),
            hidpi: false,
            count: 1,
            mirror: false,
            list: false,
            help: false,
        }
    }
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Options, String> {
    let mut options = Options::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => {
                (flag.to_string(), Some(value.to_string()))
            }
            _ => (arg.clone(), None),
        };
        let mut value = |name: &str| -> Result<String, String> {
            inline
                .clone()
                .or_else(|| args.next())
                .ok_or_else(|| format!("{name} needs a value"))
        };
        match flag.as_str() {
            "--width" => options.width = number(&value("--width")?, "--width")?,
            "--height" => options.height = number(&value("--height")?, "--height")?,
            "--hz" => {
                let raw = value("--hz")?;
                options.hz = raw
                    .parse::<f64>()
                    .ok()
                    .filter(|hz| *hz > 0.0 && *hz <= 240.0)
                    .ok_or_else(|| format!("--hz: expected a rate in (0, 240], got {raw:?}"))?;
            }
            "--name" => {
                options.name = value("--name")?;
                if options.name.trim().is_empty() {
                    return Err("--name must not be empty".into());
                }
            }
            "--count" => {
                options.count = number(&value("--count")?, "--count")?;
                if !(1..=8).contains(&options.count) {
                    return Err("--count must be between 1 and 8".into());
                }
            }
            "--hidpi" => options.hidpi = true,
            "--mirror" => options.mirror = true,
            "--list" => options.list = true,
            "-h" | "--help" => options.help = true,
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    for (flag, size) in [("--width", options.width), ("--height", options.height)] {
        if !(320..=8192).contains(&size) {
            return Err(format!("{flag} must be between 320 and 8192, got {size}"));
        }
    }
    Ok(options)
}

fn number(raw: &str, flag: &str) -> Result<u32, String> {
    raw.parse()
        .map_err(|_| format!("{flag}: expected a whole number, got {raw:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn defaults() {
        assert_eq!(parse(args(&[])).unwrap(), Options::default());
    }

    #[test]
    fn parses_all_flags() {
        let options = parse(args(&[
            "--width",
            "1280",
            "--height=720",
            "--hz",
            "30",
            "--name",
            "Stage",
            "--hidpi",
            "--count",
            "2",
            "--mirror",
        ]))
        .unwrap();
        assert_eq!(options.width, 1280);
        assert_eq!(options.height, 720);
        assert_eq!(options.hz, 30.0);
        assert_eq!(options.name, "Stage");
        assert!(options.hidpi && options.mirror);
        assert_eq!(options.count, 2);
    }

    #[test]
    fn rejects_bad_values() {
        assert!(parse(args(&["--width", "abc"])).is_err());
        assert!(parse(args(&["--count", "0"])).is_err());
        assert!(parse(args(&["--width"])).is_err());
        assert!(parse(args(&["--bogus"])).is_err());
    }
}

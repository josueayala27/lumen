//! Asset source validation and a bounded byte cache for local and remote assets.
//!
//! The scene contract carries either a local path or an http(s) URL. Remote bytes are fetched with
//! a hard size limit and kept in an LRU-ish cache so repeated revisions do not re-download a file.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::sync::Arc;
use std::time::Duration;

/// Largest response body accepted from the network.
const MAX_REMOTE_BYTES: usize = 64 * 1024 * 1024;
/// Largest total size held by the byte cache.
const MAX_CACHE_BYTES: usize = 128 * 1024 * 1024;
/// Largest number of entries held by the byte cache.
const MAX_CACHE_ENTRIES: usize = 64;
/// Whole-request timeout for remote assets.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(15);

/// A validated asset location.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AssetSource {
    Local(String),
    Remote(String),
}

impl AssetSource {
    /// Parses a contract `localPath`/`url` value. Returns `None` for empty values and for schemes
    /// other than `file`, `http` and `https`.
    pub(crate) fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim();
        if raw.is_empty() {
            return None;
        }
        if let Some(path) = strip_scheme(raw, "file") {
            let path = path.strip_prefix("//").unwrap_or(path);
            return (!path.is_empty()).then(|| Self::Local(path.to_string()));
        }
        if let Some(rest) = strip_scheme(raw, "http") {
            return valid_remote(rest).then(|| Self::Remote(raw.to_string()));
        }
        if let Some(rest) = strip_scheme(raw, "https") {
            return valid_remote(rest).then(|| Self::Remote(raw.to_string()));
        }
        if has_scheme(raw) {
            return None;
        }
        Some(Self::Local(raw.to_string()))
    }
}

/// Matches `scheme:` case-insensitively and returns the remainder.
fn strip_scheme<'a>(raw: &'a str, scheme: &str) -> Option<&'a str> {
    let rest = raw.get(scheme.len()..)?;
    if !raw
        .get(..scheme.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
    {
        return None;
    }
    rest.strip_prefix(':')
}

/// True when the value starts with an RFC 3986 scheme, but not a Windows drive letter.
fn has_scheme(raw: &str) -> bool {
    let Some((scheme, _)) = raw.split_once(':') else {
        return false;
    };
    if scheme.is_empty() {
        return false;
    }
    if scheme.len() == 1 && scheme.as_bytes()[0].is_ascii_alphabetic() {
        // `C:\path` and `C:/path` are local paths, not one-letter schemes.
        return false;
    }
    scheme
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
}

fn valid_remote(rest: &str) -> bool {
    let Some(authority) = rest.strip_prefix("//") else {
        return false;
    };
    let host = authority.split(['/', '?', '#']).next().unwrap_or_default();
    !host.is_empty()
        && !host
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
}

/// Bounded byte cache keyed by the validated source string.
#[derive(Debug)]
pub(crate) struct ByteCache {
    entries: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: usize,
    max_bytes: usize,
    max_entries: usize,
}

impl ByteCache {
    pub(crate) fn new(max_bytes: usize, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            max_bytes: max_bytes.max(1),
            max_entries: max_entries.max(1),
        }
    }

    pub(crate) fn get(&mut self, key: &str) -> Option<Arc<Vec<u8>>> {
        let value = self.entries.get(key).cloned()?;
        if let Some(position) = self.order.iter().position(|entry| entry == key) {
            if let Some(entry) = self.order.remove(position) {
                self.order.push_back(entry);
            }
        }
        Some(value)
    }

    pub(crate) fn insert(&mut self, key: String, bytes: Vec<u8>) {
        if bytes.len() > self.max_bytes {
            return;
        }
        if let Some(previous) = self.entries.insert(key.clone(), Arc::new(bytes)) {
            self.bytes = self.bytes.saturating_sub(previous.len());
            if let Some(position) = self.order.iter().position(|entry| entry == &key) {
                self.order.remove(position);
            }
        }
        self.bytes += self
            .entries
            .get(&key)
            .map(|value| value.len())
            .unwrap_or_default();
        self.order.push_back(key);
        self.evict();
    }

    fn evict(&mut self) {
        while self.order.len() > self.max_entries || self.bytes > self.max_bytes {
            let Some(key) = self.order.pop_front() else {
                break;
            };
            if let Some(value) = self.entries.remove(&key) {
                self.bytes = self.bytes.saturating_sub(value.len());
            }
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

impl Default for ByteCache {
    fn default() -> Self {
        Self::new(MAX_CACHE_BYTES, MAX_CACHE_ENTRIES)
    }
}

/// Loads local and remote asset bytes, caching both.
#[derive(Debug)]
pub(crate) struct AssetLoader {
    cache: ByteCache,
}

impl AssetLoader {
    pub(crate) fn new() -> Self {
        Self {
            cache: ByteCache::default(),
        }
    }

    pub(crate) fn load(&mut self, source: &AssetSource, hash: &str) -> Option<Arc<Vec<u8>>> {
        let key = match source {
            AssetSource::Local(path) => format!("file:{path}#{hash}"),
            AssetSource::Remote(url) => format!("url:{url}#{hash}"),
        };
        if let Some(cached) = self.cache.get(&key) {
            return Some(cached);
        }
        let bytes = match source {
            AssetSource::Local(path) => fs::read(path).ok()?,
            AssetSource::Remote(url) => fetch_remote(url)?,
        };
        self.cache.insert(key.clone(), bytes);
        self.cache.get(&key)
    }
}

impl Default for AssetLoader {
    fn default() -> Self {
        Self::new()
    }
}

/// Fetches a remote asset into memory. Never called by tests.
fn fetch_remote(url: &str) -> Option<Vec<u8>> {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(REMOTE_TIMEOUT))
        .build();
    let agent: ureq::Agent = config.into();
    let mut response = agent.get(url).call().ok()?;
    let bytes = response
        .body_mut()
        .with_config()
        .limit((MAX_REMOTE_BYTES + 1) as u64)
        .read_to_vec()
        .ok()?;
    (bytes.len() <= MAX_REMOTE_BYTES).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_and_invalid_sources() {
        assert_eq!(
            AssetSource::parse("https://example.test/a.png"),
            Some(AssetSource::Remote("https://example.test/a.png".into()))
        );
        assert_eq!(
            AssetSource::parse("HTTP://example.test/a.png"),
            Some(AssetSource::Remote("HTTP://example.test/a.png".into()))
        );
        assert_eq!(
            AssetSource::parse("file:///tmp/a.png"),
            Some(AssetSource::Local("/tmp/a.png".into()))
        );
        assert_eq!(
            AssetSource::parse("/tmp/a.png"),
            Some(AssetSource::Local("/tmp/a.png".into()))
        );
        assert_eq!(
            AssetSource::parse("C:\\media\\a.png"),
            Some(AssetSource::Local("C:\\media\\a.png".into()))
        );
        assert_eq!(AssetSource::parse("   "), None);
        assert_eq!(AssetSource::parse("ftp://example.test/a.png"), None);
        assert_eq!(AssetSource::parse("data:image/png;base64,AAAA"), None);
        assert_eq!(AssetSource::parse("javascript:alert(1)"), None);
        assert_eq!(AssetSource::parse("https:///missing-host"), None);
    }

    #[test]
    fn cache_evicts_by_entry_count() {
        let mut cache = ByteCache::new(1_000, 2);
        cache.insert("a".into(), vec![1]);
        cache.insert("b".into(), vec![2]);
        cache.insert("c".into(), vec![3]);
        assert_eq!(cache.len(), 2);
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        assert!(cache.get("c").is_some());
    }

    #[test]
    fn cache_evicts_by_byte_budget() {
        let mut cache = ByteCache::new(4, 8);
        cache.insert("a".into(), vec![1; 3]);
        cache.insert("b".into(), vec![2; 3]);
        assert_eq!(cache.len(), 1);
        assert!(cache.get("a").is_none());
        assert_eq!(cache.get("b").map(|value| value.len()), Some(3));
    }

    #[test]
    fn cache_rejects_entries_larger_than_budget() {
        let mut cache = ByteCache::new(4, 8);
        cache.insert("a".into(), vec![1; 5]);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn cache_keeps_hits_alive_and_updates_values() {
        let mut cache = ByteCache::new(1_000, 2);
        cache.insert("a".into(), vec![1]);
        cache.insert("b".into(), vec![2]);
        assert!(cache.get("a").is_some());
        cache.insert("c".into(), vec![3]);
        assert!(cache.get("a").is_some(), "hit moves entry to the back");
        cache.insert("a".into(), vec![9; 2]);
        assert_eq!(cache.get("a").map(|value| value[0]), Some(9));
    }
}

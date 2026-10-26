use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BandLine {
    pub id: u8,
    pub rssi: i8,
    pub flags: u8,
    pub neigh: u8,
    pub zone: u8,
    pub bat: u8,
    pub state: u8,
    pub seq: u16,
    pub find: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ack {
    pub target: u8,
    pub cmd: u8,
    pub arg: u8,
    pub arg2: u8,
}

#[derive(Debug)]
pub enum Line {
    Band(BandLine),
    Station { id: u8, exit_colour: u8, rssi: i8 },
    Heard { id: u8, heard: Vec<(u8, i8)> },
    Gateway { mac: String, fw: String },
    Ack(Ack),
    CommandError(String),
    Error(String),
    Other,
}

#[derive(Deserialize)]
struct Packet {
    #[serde(rename = "type")]
    kind: u8,
    id: u8,
    rssi: i8,
    #[serde(default)]
    flags: u8,
    #[serde(default)]
    neigh: u8,
    #[serde(default)]
    zone: u8,
    #[serde(default)]
    bat: u8,
    #[serde(default)]
    state: u8,
    #[serde(default)]
    seq: u16,
    #[serde(default)]
    find: u8,
    #[serde(default)]
    heard: Vec<(u8, i8)>,
}

#[derive(Deserialize)]
struct AckFields {
    target: u8,
    cmd: u8,
    #[serde(default)]
    arg: u8,
    #[serde(default)]
    arg2: u8,
}

const COMMAND_ERRORS: &[&str] = &["usage", "unknown cmd", "bad args", "busy"];

pub fn parse(line: &str) -> Line {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return Line::Other;
    };
    if v.get("type").is_some() {
        let Ok(p) = serde_json::from_value::<Packet>(v) else {
            return Line::Other;
        };
        return match p.kind {
            1 => Line::Band(BandLine {
                id: p.id,
                rssi: p.rssi,
                flags: p.flags,
                neigh: p.neigh,
                zone: p.zone,
                bat: p.bat,
                state: p.state,
                seq: p.seq,
                find: p.find,
            }),
            2 => Line::Station { id: p.id, exit_colour: p.state, rssi: p.rssi },
            4 => Line::Heard { id: p.id, heard: p.heard },
            _ => Line::Other,
        };
    }
    let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    if v.get("gateway").is_some() || v.get("info").and_then(Value::as_str) == Some("gateway") {
        return Line::Gateway { mac: text("mac"), fw: text("fw") };
    }
    if v.get("ack").is_some() {
        return match serde_json::from_value::<AckFields>(v) {
            Ok(a) => Line::Ack(Ack { target: a.target, cmd: a.cmd, arg: a.arg, arg2: a.arg2 }),
            Err(_) => Line::Other,
        };
    }
    if let Some(e) = v.get("err").and_then(Value::as_str) {
        return if COMMAND_ERRORS.iter().any(|c| e.starts_with(c)) {
            Line::CommandError(e.to_string())
        } else {
            Line::Error(line.to_string())
        };
    }
    Line::Other
}

const COMMANDS: &[(&str, u8, usize, u8)] = &[
    ("state", 1, 2, 0),
    ("exit", 2, 1, 0),
    ("clear", 3, 0, 0),
    ("buzz", 4, 1, 1),
    ("pay", 5, 0, 0),
    ("paid", 6, 0, 0),
    ("thresh", 7, 2, 0),
    ("rssi", 8, 2, 0),
    ("override", 9, 1, 0),
    ("find", 10, 2, 0),
    ("sleep", 11, 1, 0),
    ("haptic", 12, 1, 0),
    ("lowvis", 13, 1, 0),
];

fn command(name: &str) -> Option<&'static (&'static str, u8, usize, u8)> {
    COMMANDS.iter().find(|c| c.0 == name)
}

pub fn arg_count(name: &str) -> usize {
    command(name).map(|c| c.2).unwrap_or(2)
}

pub fn command_line(target: u8, name: &str, arg: u8, arg2: u8) -> String {
    let args = [arg, arg2];
    let mut line = format!("cmd {target} {name}");
    for a in &args[..arg_count(name)] {
        line.push_str(&format!(" {a}"));
    }
    line.push('\n');
    line
}

pub fn expected_ack(target: u8, name: &str, arg: u8, arg2: u8) -> Option<Ack> {
    let &(_, cmd, count, default) = command(name)?;
    let arg = if count >= 1 { arg } else { default };
    let arg2 = if count >= 2 { arg2 } else { 0 };
    Some(Ack { target, cmd, arg, arg2 })
}

pub fn parse_bands(spec: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        if let Some((a, b)) = part.split_once('-') {
            let (a, b) = (a.trim().parse::<u8>().ok()?, b.trim().parse::<u8>().ok()?);
            if a == 0 || b < a || b > 99 {
                return None;
            }
            out.extend(a..=b);
        } else {
            let v = part.parse::<u8>().ok()?;
            if v == 0 || v > 99 {
                return None;
            }
            out.push(v);
        }
    }
    (!out.is_empty()).then_some(out)
}

pub struct Lines {
    buf: Vec<u8>,
    skip_partial: bool,
}

impl Lines {
    pub fn new() -> Self {
        Lines { buf: Vec::new(), skip_partial: true }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        for &b in bytes {
            if b == b'\n' || b == b'\r' {
                if self.skip_partial {
                    self.skip_partial = false;
                } else if !self.buf.is_empty() {
                    out.push(String::from_utf8_lossy(&self.buf).into_owned());
                }
                self.buf.clear();
            } else if self.buf.len() < 4096 {
                self.buf.push(b);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_line_type() {
        let band = r#"{"t":5067,"type":1,"id":3,"rssi":-65,"flags":5,"neigh":4,"zone":101,"bat":255,"state":2,"seq":1165,"find":7}"#;
        match parse(band) {
            Line::Band(b) => assert_eq!((b.id, b.flags, b.state, b.find, b.seq), (3, 5, 2, 7, 1165)),
            other => panic!("{other:?}"),
        }
        match parse(r#"{"t":1,"type":2,"id":101,"rssi":-19,"flags":0,"neigh":0,"zone":0,"bat":0,"state":4,"seq":9}"#) {
            Line::Station { id, exit_colour, rssi } => assert_eq!((id, exit_colour, rssi), (101, 4, -19)),
            other => panic!("{other:?}"),
        }
        match parse(r#"{"t":1,"type":4,"id":2,"rssi":-67,"heard":[[101,-44],[3,-61]]}"#) {
            Line::Heard { id, heard } => assert_eq!((id, heard), (2, vec![(101, -44), (3, -61)])),
            other => panic!("{other:?}"),
        }
        assert!(matches!(parse(r#"{"gateway":"up","mac":"AC:27","channel":1,"fw":"f98183b"}"#), Line::Gateway { .. }));
        match parse(r#"{"ack":"cmd","target":0,"cmd":1,"arg":3,"arg2":0}"#) {
            Line::Ack(a) => assert_eq!(a, Ack { target: 0, cmd: 1, arg: 3, arg2: 0 }),
            other => panic!("{other:?}"),
        }
        assert!(matches!(parse(r#"{"err":"bad args"}"#), Line::CommandError(_)));
        assert!(matches!(parse(r#"{"err":"busy"}"#), Line::CommandError(_)));
        assert!(matches!(parse(r#"{"err":"dup id","id":3,"mac":"A","other":"B"}"#), Line::Error(_)));
        assert!(matches!(parse("ESP-ROM:esp32c3"), Line::Other));
    }

    #[test]
    fn formats_each_command_with_its_arguments() {
        assert_eq!(command_line(3, "state", 8, 80), "cmd 3 state 8 80\n");
        assert_eq!(command_line(3, "state", 0, 1), "cmd 3 state 0 1\n");
        assert_eq!(command_line(0, "thresh", 3, 5), "cmd 0 thresh 3 5\n");
        assert_eq!(command_line(0, "rssi", 62, 58), "cmd 0 rssi 62 58\n");
        assert_eq!(command_line(2, "find", 7, 1), "cmd 2 find 7 1\n");
        assert_eq!(command_line(4, "clear", 9, 9), "cmd 4 clear\n");
        assert_eq!(command_line(4, "exit", 2, 9), "cmd 4 exit 2\n");
        assert_eq!(command_line(0, "override", 1, 0), "cmd 0 override 1\n");
        assert_eq!(command_line(5, "haptic", 4, 0), "cmd 5 haptic 4\n");
        assert_eq!(command_line(0, "lowvis", 1, 0), "cmd 0 lowvis 1\n");
        assert_eq!(command_line(6, "sleep", 0, 0), "cmd 6 sleep 0\n");
        assert_eq!(command_line(1, "buzz", 2, 0), "cmd 1 buzz 2\n");
        assert_eq!(command_line(1, "pay", 0, 0), "cmd 1 pay\n");
    }

    #[test]
    fn expects_the_ack_the_gateway_prints() {
        assert_eq!(expected_ack(3, "state", 8, 80), Some(Ack { target: 3, cmd: 1, arg: 8, arg2: 80 }));
        assert_eq!(expected_ack(4, "clear", 7, 7), Some(Ack { target: 4, cmd: 3, arg: 0, arg2: 0 }));
        assert_eq!(expected_ack(4, "exit", 2, 9), Some(Ack { target: 4, cmd: 2, arg: 2, arg2: 0 }));
        assert_eq!(expected_ack(0, "rssi", 62, 58), Some(Ack { target: 0, cmd: 8, arg: 62, arg2: 58 }));
        assert_eq!(expected_ack(1, "pay", 5, 5), Some(Ack { target: 1, cmd: 5, arg: 0, arg2: 0 }));
        assert_eq!(expected_ack(1, "nope", 0, 0), None);
        let from_gateway = match parse(r#"{"ack":"cmd","target":3,"cmd":1,"arg":8,"arg2":80}"#) {
            Line::Ack(a) => a,
            other => panic!("{other:?}"),
        };
        assert_eq!(Some(from_gateway), expected_ack(3, "state", 8, 80));
        assert_ne!(Some(from_gateway), expected_ack(3, "state", 0, 1));
    }

    #[test]
    fn reads_band_ranges() {
        assert_eq!(parse_bands("1-9"), Some((1..=9).collect()));
        assert_eq!(parse_bands("1,2, 5"), Some(vec![1, 2, 5]));
        assert_eq!(parse_bands("1-3,9"), Some(vec![1, 2, 3, 9]));
        assert_eq!(parse_bands("0-9"), None);
        assert_eq!(parse_bands("5-2"), None);
        assert_eq!(parse_bands("1-120"), None);
        assert_eq!(parse_bands(""), None);
    }

    #[test]
    fn drops_the_partial_first_line() {
        let mut lines = Lines::new();
        assert!(lines.push(b"e\":3}\n{\"a\":1}").is_empty());
        assert_eq!(lines.push(b"\r\n{\"b\":2}\n"), vec!["{\"a\":1}".to_string(), "{\"b\":2}".to_string()]);
        assert_eq!(lines.push(b"{\"c\""), Vec::<String>::new());
        assert_eq!(lines.push(b":3}\n"), vec!["{\"c\":3}".to_string()]);
    }
}

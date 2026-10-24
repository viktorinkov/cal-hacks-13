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

#[derive(Debug)]
pub enum Line {
    Band(BandLine),
    Station { id: u8, exit_colour: u8, rssi: i8 },
    Heard { id: u8, heard: Vec<(u8, i8)> },
    Gateway { mac: String, fw: String },
    Ack,
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
        return Line::Ack;
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
        assert!(matches!(parse(r#"{"ack":"cmd","target":0,"cmd":1,"arg":3,"arg2":0}"#), Line::Ack));
        assert!(matches!(parse(r#"{"err":"bad args"}"#), Line::CommandError(_)));
        assert!(matches!(parse(r#"{"err":"dup id","id":3,"mac":"A","other":"B"}"#), Line::Error(_)));
        assert!(matches!(parse("ESP-ROM:esp32c3"), Line::Other));
    }
}

//! Text printed as a PDF: the hospital report the hospital in the scripted
//! claims run sends. Each page's lines are set in Helvetica, long lines wrapped
//! at word breaks, so the page's text layer holds every word as printed.

use anyhow::{Result, bail};
use lopdf::content::{Content, Operation};
use lopdf::{Document, Object, Stream, dictionary};

const FONT_SIZE: f32 = 10.0;
const LEADING: f32 = 13.0;
const LEFT: f32 = 54.0;
const TOP: f32 = 740.0;
const BOTTOM: f32 = 48.0;
/// Characters per line: Helvetica at 10 pt averages under 5 pt a character, on a 504 pt line.
const WRAP: usize = 100;

/// A letter-size PDF with one page for each string, its lines in order.
pub fn text_pdf(pages: &[String]) -> Result<Vec<u8>> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding" });
    let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
    let fits = ((TOP - BOTTOM) / LEADING) as usize + 1;
    let mut kids: Vec<Object> = Vec::new();
    for (n, text) in pages.iter().enumerate() {
        let lines: Vec<String> = text.lines().flat_map(wrap).collect();
        if lines.len() > fits {
            bail!("page {} has {} lines, more than the {fits} that fit", n + 1, lines.len());
        }
        let mut operations = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), FONT_SIZE.into()]),
            Operation::new("TL", vec![LEADING.into()]),
            Operation::new("Td", vec![LEFT.into(), TOP.into()]),
        ];
        for line in &lines {
            operations.push(Operation::new("Tj", vec![Object::string_literal(win_ansi(line))]));
            operations.push(Operation::new("T*", vec![]));
        }
        operations.push(Operation::new("ET", vec![]));
        let content_id = doc.add_object(Stream::new(dictionary! {}, Content { operations }.encode()?));
        kids.push(doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content_id }).into());
    }
    let count = kids.len() as i64;
    let tree = dictionary! {
        "Type" => "Pages", "Kids" => kids, "Count" => count,
        "Resources" => resources_id, "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
    };
    doc.objects.insert(pages_id, Object::Dictionary(tree));
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let mut out = Vec::new();
    doc.save_to(&mut out)?;
    Ok(out)
}

/// One printed line as lines of at most `WRAP` characters, broken between words.
fn wrap(line: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    for word in line.split_whitespace() {
        let last = out.last_mut().unwrap();
        if !last.is_empty() && last.chars().count() + 1 + word.chars().count() > WRAP {
            out.push(word.to_string());
        } else {
            if !last.is_empty() {
                last.push(' ');
            }
            last.push_str(word);
        }
    }
    out
}

/// The line in the font's WinAnsi encoding; a character it lacks prints as `?`.
fn win_ansi(line: &str) -> Vec<u8> {
    line.chars()
        .map(|c| match c {
            '\u{20}'..='\u{7E}' | '\u{A0}'..='\u{FF}' => c as u8,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{2026}' => 0x85,
            _ => b'?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prints_each_page_with_its_words() {
        let history = "Slipped on a spilled drink near the main stage at Cal Hacks 13.0 and fell onto the outstretched right hand. ".repeat(4);
        let pages = vec![format!("WRENFIELD URGENT CARE\nPatient: Maya Chen\n{history}"), "ITEMIZED BILL\n2026-10-24  99213  Office visit  1  $180.00".to_string()];
        let pdf = text_pdf(&pages).unwrap();
        let doc = Document::load_mem(&pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
        let first = doc.extract_text(&[1]).unwrap();
        assert!(first.contains("Patient: Maya Chen") && first.contains("outstretched"), "{first}");
        assert!(doc.extract_text(&[2]).unwrap().contains("99213"));
        assert!(wrap(&history).iter().all(|l| l.chars().count() <= WRAP));
        assert_eq!(wrap(""), [""]);
        assert_eq!(win_ansi("caf\u{e9} \u{2014} \u{2713}"), [b'c', b'a', b'f', 0xE9, b' ', 0x97, b' ', b'?']);
        assert!(text_pdf(&["x\n".repeat(80)]).is_err());
    }
}

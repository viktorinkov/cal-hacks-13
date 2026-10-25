/// PDF pages, counted by their `/Type /Page` objects the way the claims CLI counts them; at least 1.
pub fn count_pages(pdf: &[u8]) -> u32 {
    let mut n = 0;
    let mut i = 0;
    while let Some(at) = pdf[i..].windows(5).position(|w| w == b"/Type") {
        let mut j = i + at + 5;
        while j < pdf.len() && pdf[j].is_ascii_whitespace() {
            j += 1;
        }
        if pdf[j..].starts_with(b"/Page") && !pdf.get(j + 5).is_some_and(|c| c.is_ascii_alphanumeric()) {
            n += 1;
        }
        i = j;
    }
    n.max(1)
}

#[cfg(test)]
mod tests {
    #[test]
    fn counts_page_objects_not_the_page_tree() {
        assert_eq!(super::count_pages(b"<</Type /Pages /Count 2>> <</Type /Page>> <</Type/Page /Parent 1>>"), 2);
        assert_eq!(super::count_pages(b"%PDF-1.7"), 1);
    }
}

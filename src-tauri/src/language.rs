//! Which language a text is in (Dutch or English), from its common function
//! words. Used where a model needs to be told the language: summaries and the
//! writing tools.

pub fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// The language of a piece of text, when its function words make it clear.
pub fn text_language(text: &str) -> Option<&'static str> {
    match votes(text) {
        (nl, en) if nl > en => Some("nl"),
        (nl, en) if en > nl => Some("en"),
        _ => None,
    }
}

/// How many common Dutch and English function words the text has.
pub fn votes(text: &str) -> (usize, usize) {
    const NL: &[&str] = &["de", "het", "een", "en", "ik", "je", "niet", "dat", "van", "zijn", "voor", "met", "op", "ook", "maar", "wel", "nog", "wat", "dan"];
    const EN: &[&str] = &["the", "and", "to", "of", "you", "that", "it", "for", "with", "on", "this", "not", "but", "are", "have", "what", "so", "just"];
    let (mut nl, mut en) = (0, 0);
    for w in words(text) {
        nl += NL.contains(&w.as_str()) as usize;
        en += EN.contains(&w.as_str()) as usize;
    }
    (nl, en)
}

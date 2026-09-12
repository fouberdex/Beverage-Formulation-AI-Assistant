from beverage_rag.preprocessing.cleaning import chunk_words, clean_text


def test_clean_text_removes_markup_controls_and_dehyphenates() -> None:
    dirty = "<p>Carbon-\nated\x00 beverage</p>\n\n\n stability"
    assert clean_text(dirty) == "Carbonated beverage\n\nstability"


def test_chunk_words_overlaps_without_losing_tail() -> None:
    text = " ".join(f"word{index}" for index in range(25))
    chunks = chunk_words(text, size=10, overlap=2, minimum=3)

    assert len(chunks) == 3
    assert chunks[0].split()[-2:] == chunks[1].split()[:2]
    assert chunks[-1].split()[-1] == "word24"


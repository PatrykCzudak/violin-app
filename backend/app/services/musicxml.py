from music21 import converter

def parse_file(path: str):
    """
    Zwraca podstawowe metadane partytury do wyświetlenia w UI.
    """
    score = converter.parse(path)
    title = (score.metadata and score.metadata.title) or path.split("/")[-1]
    parts = len(score.parts)
    # proste liczenie taktów (może być niedokładne w złożonych partyturach)
    measures = sum(len(p.getElementsByClass('Measure')) for p in score.parts)
    kind = "musicxml" if path.lower().endswith((".musicxml", ".xml", ".mxl")) else "midi"
    return {
        "title": title, "parts": parts, "measures": measures, "kind": kind
    }

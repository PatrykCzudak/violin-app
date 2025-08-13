from typing import List, Optional

class SimpleFollower:
    """
    Bardzo uproszczony placeholder: idzie po nutach sekwencyjnie.
    Docelowo: DTW/HMM + dopasowanie w czasie rzeczywistym.
    """
    def __init__(self, expected_notes: List[str]):
        self.expected = expected_notes
        self.idx = 0

    def update(self, detected_note: Optional[str]) -> int:
        if detected_note and self.idx < len(self.expected):
            exp = self.expected[self.idx]
            # toleruj enharmonię: uproszczenie (tylko litery, bez #)
            if detected_note[0] == exp[0]:
                self.idx += 1
        return self.idx  # indeks aktualnej nuty (do podświetlenia)

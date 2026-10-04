"""The 20-symbol universe. Real ticker symbols and company names only (owner decision);
every price, volume and event is synthetic."""

from dataclasses import dataclass

SECTORS: dict[str, list[tuple[str, str]]] = {
    "Technology": [
        ("AAPL", "Apple Inc."),
        ("MSFT", "Microsoft Corporation"),
        ("NVDA", "NVIDIA Corporation"),
        ("ORCL", "Oracle Corporation"),
    ],
    "Financials": [
        ("JPM", "JPMorgan Chase & Co."),
        ("BAC", "Bank of America Corporation"),
        ("GS", "The Goldman Sachs Group, Inc."),
        ("V", "Visa Inc."),
    ],
    "Healthcare": [
        ("JNJ", "Johnson & Johnson"),
        ("PFE", "Pfizer Inc."),
        ("UNH", "UnitedHealth Group Incorporated"),
        ("MRK", "Merck & Co., Inc."),
    ],
    "Energy": [
        ("XOM", "Exxon Mobil Corporation"),
        ("CVX", "Chevron Corporation"),
        ("COP", "ConocoPhillips"),
        ("SLB", "SLB"),
    ],
    "Consumer": [
        ("KO", "The Coca-Cola Company"),
        ("PEP", "PepsiCo, Inc."),
        ("WMT", "Walmart Inc."),
        ("MCD", "McDonald's Corporation"),
    ],
}


@dataclass(frozen=True)
class Symbol:
    id: int
    ticker: str
    name: str
    sector: str
    spread: int  # cents


def base_universe() -> list[tuple[str, str, str]]:
    """(ticker, name, sector) in fixed order; symbol ids are 1-based positions."""
    return [(t, n, sector) for sector, rows in SECTORS.items() for t, n in rows]

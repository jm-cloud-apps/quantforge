"""Curated narrative themes for the Theme Radar.

These are deliberately NOT GICS sectors. Each is a high-velocity *market
narrative* — the kind of custom basket institutional desks actually rotate
through — defined by its constituent leaders and a representative "lead ETF"
used to read the immediate tape (% from open / 5-day persistence).

Key structural note baked in: the **AI Data Center Infrastructure** theme is the
"Bitcoin Miners" basket re-framed. The miners (MARA, RIOT, CLSK, WULF, IREN,
CORZ, APLD…) are increasingly HPC / AI-compute hosts, so they're analysed
alongside the power and hardware names as a single physical-AI-compute pipeline,
not as crypto beta. Pure crypto beta lives in its own `Crypto / Digital Assets`
theme so the two narratives don't get conflated.

Tickers are liquid US leaders; baskets are intentionally tight (the leaders that
move the narrative) rather than exhaustive index memberships.
"""

# name → {narrative, lead_etf, tickers}
THEMES: dict[str, dict] = {
    "AI Data Center Infrastructure": {
        "narrative": "Physical AI-compute buildout — GPUs, power/cooling hardware, and the "
                     "miners-turned-HPC hosts leasing capacity to hyperscalers. Capital is paying "
                     "for power capacity and compute, not crypto beta.",
        "lead_etf": "SMH",  # no pure ETF; semis proxy the demand pull
        "tickers": ["NVDA", "TSM", "AVGO", "SMCI", "VRT", "DELL", "ANET", "CORZ", "APLD",
                    "WULF", "IREN", "MARA", "RIOT", "CLSK", "NBIS", "CRWV", "POWL", "MOD"],
    },
    "Power & Nuclear (AI Demand)": {
        "narrative": "The grid-side bottleneck of the AI buildout — independent power producers and "
                     "nuclear/SMR names re-rating on hyperscaler power-purchase demand.",
        "lead_etf": "NLR",
        "tickers": ["VST", "CEG", "TLN", "NRG", "GEV", "OKLO", "SMR", "NNE", "CCJ", "LEU", "ETR", "PWR"],
    },
    "AI Semiconductors": {
        "narrative": "Compute and memory leverage to AI capex — accelerators, memory, networking and "
                     "the equipment that builds them.",
        "lead_etf": "SMH",
        "tickers": ["NVDA", "AVGO", "AMD", "TSM", "MU", "ARM", "MRVL", "LRCX", "AMAT", "KLAC", "ASML", "MPWR"],
    },
    "Quantum Computing": {
        "narrative": "Speculative but institutionally-tracked frontier compute — pure-play quantum "
                     "hardware/software with violent narrative velocity.",
        "lead_etf": "QTUM",
        "tickers": ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ", "LAES"],
    },
    "Robotics & Automation": {
        "narrative": "Humanoid + industrial automation and machine-vision — the physical-AI labor "
                     "narrative feeding off the same compute pipeline.",
        "lead_etf": "BOTZ",
        "tickers": ["ISRG", "SYM", "PATH", "SERV", "RR", "ROK", "TER", "ABB", "NVDA", "ZBRA"],
    },
    "Cybersecurity": {
        "narrative": "Secular software spend that's defensive in a risk-off tape — platform "
                     "consolidators with durable institutional sponsorship.",
        "lead_etf": "CIBR",
        "tickers": ["CRWD", "PANW", "ZS", "FTNT", "NET", "S", "OKTA", "CYBR", "RBRK", "TENB"],
    },
    "Space & Defense Tech": {
        "narrative": "Launch, satellite, drones and defense-software — a re-rating government-spend "
                     "narrative with high-beta movers.",
        "lead_etf": "ITA",
        "tickers": ["RKLB", "LUNR", "ASTS", "PLTR", "KTOS", "AVAV", "LMT", "RTX", "ACHR", "RCAT"],
    },
    "Genomics & Gene Editing": {
        "narrative": "High-duration biotech narrative — CRISPR/gene-editing and the broader emerging "
                     "biotech tape that leads risk appetite.",
        "lead_etf": "XBI",
        "tickers": ["CRSP", "NTLA", "BEAM", "VERV", "RXRX", "TEM", "ARWR", "DNA", "ABSI"],
    },
    "Crypto / Digital Assets": {
        "narrative": "Pure crypto beta — exchanges, treasury-proxy holders and brokers. Kept distinct "
                     "from the AI-compute miners so the two narratives stay separable.",
        "lead_etf": "BITQ",
        "tickers": ["COIN", "MSTR", "HOOD", "BMNR", "CIFR", "HUT", "BITF", "GLXY"],
    },
    "eVTOL & Drones": {
        "narrative": "Electric-air-mobility and autonomous drones — early-revenue, high-velocity "
                     "narrative names with episodic catalysts.",
        "lead_etf": "ITA",
        "tickers": ["ACHR", "JOBY", "EH", "ONDS", "RCAT", "UMAC", "AVAV"],
    },
    "Obesity / GLP-1": {
        "narrative": "The metabolic-drug supercycle — branded GLP-1 leaders and the next-gen "
                     "challengers institutions accumulate on weakness.",
        "lead_etf": "XLV",
        "tickers": ["LLY", "NVO", "VKTX", "AMGN", "HIMS", "STVN"],
    },
    "Nuclear & Uranium Fuel": {
        "narrative": "The fuel-cycle leg of the power narrative — uranium miners and enrichers "
                     "levered to the reactor-restart and SMR cycle.",
        "lead_etf": "URA",
        "tickers": ["CCJ", "LEU", "UEC", "DNN", "UUUU", "NXE", "OKLO", "SMR"],
    },
}


def all_tickers() -> list[str]:
    """Every unique constituent + lead ETF across all themes (one fetch covers all)."""
    syms: set[str] = set()
    for t in THEMES.values():
        syms.update(t["tickers"])
        if t.get("lead_etf"):
            syms.add(t["lead_etf"])
    return sorted(syms)

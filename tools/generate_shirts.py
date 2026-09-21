#!/usr/bin/env python3
"""Generate the SVG shirt assets and assets/catalog.json.

Every shirt shares one coordinate system (600 x 720) so the fitting code can
rely on the same anchors: the two shoulder points and the hip line.

    python3 tools/generate_shirts.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "shirts"
W, H = 600, 720

# Anchors (shirt-space pixels) used by the fitting algorithm.
ANCHORS = {"sl": [130, 100], "sr": [470, 100], "hipY": 570}

BODY = (
    "M230,60 Q300,150 370,60 L470,92 L588,214 L530,270 L470,222 "
    "L470,690 Q300,712 130,690 L130,222 L70,270 L12,214 L130,92 Z"
)
POLO_BODY = (
    "M226,58 Q300,118 374,58 L470,92 L588,214 L530,270 L470,222 "
    "L470,690 Q300,712 130,690 L130,222 L70,270 L12,214 L130,92 Z"
)


def shade(hex_color: str, amount: float) -> str:
    """Lighten (amount>0) or darken (amount<0) a #rrggbb colour."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    f = (lambda c: int(c + (255 - c) * amount)) if amount > 0 else (lambda c: int(c * (1 + amount)))
    return "#%02x%02x%02x" % (f(r), f(g), f(b))


def common_defs(uid: str, color: str) -> str:
    return f"""
  <defs>
    <linearGradient id="side-{uid}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity=".30"/>
      <stop offset=".16" stop-color="#000" stop-opacity=".05"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".07"/>
      <stop offset=".84" stop-color="#000" stop-opacity=".05"/>
      <stop offset="1" stop-color="#000" stop-opacity=".30"/>
    </linearGradient>
    <linearGradient id="fade-{uid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".10"/>
      <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".18"/>
    </linearGradient>
    <clipPath id="clip-{uid}"><path d="{{body}}"/></clipPath>
  </defs>"""


def build(item: dict) -> str:
    uid = item["id"]
    color = item["color"]
    style = item["style"]
    body = POLO_BODY if style == "polo" else BODY
    dark = shade(color, -0.28)
    edge = shade(color, -0.45)
    light = shade(color, 0.18)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        common_defs(uid, color).replace("{body}", body),
        f'  <path d="{body}" fill="{color}"/>',
    ]

    if style == "stripe":
        stripe = item["stripe"]
        rects = "".join(
            f'<rect x="0" y="{y}" width="{W}" height="22" fill="{stripe}"/>' for y in range(86, H, 46)
        )
        parts.append(f'  <g clip-path="url(#clip-{uid})">{rects}</g>')

    # Shading & folds
    parts += [
        f'  <path d="{body}" fill="url(#side-{uid})"/>',
        f'  <path d="{body}" fill="url(#fade-{uid})"/>',
        f'  <g clip-path="url(#clip-{uid})" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="5" stroke-linecap="round">'
        '<path d="M205,250 Q225,420 190,640"/><path d="M395,260 Q372,430 410,650"/>'
        '<path d="M255,140 Q300,200 345,140" stroke-opacity=".05"/></g>',
    ]

    # Neckline
    if style == "polo":
        parts += [
            # back of collar
            f'  <path d="M226,58 Q300,118 374,58 Q300,76 226,58 Z" fill="{dark}"/>',
            # collar flaps
            f'  <path d="M214,50 L300,132 L258,160 L186,82 Z" fill="{light}" stroke="{edge}" stroke-width="3" stroke-linejoin="round"/>',
            f'  <path d="M386,50 L300,132 L342,160 L414,82 Z" fill="{light}" stroke="{edge}" stroke-width="3" stroke-linejoin="round"/>',
            # placket
            f'  <rect x="287" y="128" width="26" height="130" rx="3" fill="{shade(color, 0.06)}" stroke="{edge}" stroke-opacity=".6" stroke-width="2"/>',
            *[f'  <circle cx="300" cy="{y}" r="5" fill="{shade(color, 0.45)}" stroke="{edge}" stroke-width="1.5"/>' for y in (156, 190, 224)],
        ]
    else:
        parts += [
            f'  <path d="M230,60 Q300,150 370,60 Q300,84 230,60 Z" fill="{dark}"/>',
            f'  <path d="M230,60 Q300,150 370,60" fill="none" stroke="{shade(color, -0.12)}" stroke-width="10" stroke-linecap="round"/>',
            f'  <path d="M236,66 Q300,150 364,66" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="2"/>',
        ]

    # Hem + sleeve stitching, outline
    parts += [
        f'  <path d="M133,672 Q300,694 467,672" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2" stroke-dasharray="7 5"/>',
        f'  <path d="M582,222 L526,262" stroke="#000" stroke-opacity=".28" stroke-width="2" stroke-dasharray="6 4"/>',
        f'  <path d="M18,222 L74,262" stroke="#000" stroke-opacity=".28" stroke-width="2" stroke-dasharray="6 4"/>',
        f'  <path d="{body}" fill="none" stroke="{edge}" stroke-opacity=".75" stroke-width="3" stroke-linejoin="round"/>',
        "</svg>",
    ]
    return "\n".join(parts)


SHIRTS = [
    dict(id="tee-navy", name="Classic Tee", category="T-Shirt", style="tee", color="#24427a"),
    dict(id="tee-crimson", name="Crimson Crew", category="T-Shirt", style="tee", color="#b3262f"),
    dict(id="tee-forest", name="Forest Tee", category="T-Shirt", style="tee", color="#2f6f4e"),
    dict(id="tee-white", name="Essential White", category="T-Shirt", style="tee", color="#eeece6"),
    dict(id="tee-black", name="Midnight Tee", category="T-Shirt", style="tee", color="#1a1b21"),
    dict(id="stripe-breton", name="Breton Stripe", category="Striped", style="stripe", color="#f1eee6", stripe="#24427a"),
    dict(id="polo-teal", name="Performance Polo", category="Polo", style="polo", color="#12808b"),
    dict(id="polo-sand", name="Resort Polo", category="Polo", style="polo", color="#c9a46b"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = []
    for item in SHIRTS:
        (OUT / f"{item['id']}.svg").write_text(build(item), encoding="utf-8")
        catalog.append(
            {
                "id": item["id"],
                "name": item["name"],
                "category": item["category"],
                "swatch": item["color"],
                "src": f"assets/shirts/{item['id']}.svg",
                "size": [W, H],
                "anchors": ANCHORS,
            }
        )
    (ROOT / "assets" / "catalog.json").write_text(json.dumps({"version": 1, "items": catalog}, indent=2), encoding="utf-8")
    print(f"Generated {len(catalog)} shirts")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "assets" / "fonts" / "Geologica-Variable.woff2"
OUTPUT = Path(__file__).resolve().parent / "Resources" / "Fonts"

WEIGHTS = [
    (400, "Regular"),
    (500, "Medium"),
    (600, "SemiBold"),
    (700, "Bold"),
]


def set_name(font, name_id, value):
    font["name"].setName(value, name_id, 3, 1, 0x409)
    font["name"].setName(value, name_id, 1, 0, 0)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for weight, style in WEIGHTS:
        font = TTFont(SOURCE)
        font.flavor = None
        instantiateVariableFont(
            font,
            {"wght": weight, "CRSV": 0, "SHRP": 0, "slnt": 0},
            inplace=True,
            optimize=True,
        )
        family = "Geologica"
        postscript = f"Geologica-{style.replace(' ', '')}"
        set_name(font, 1, family)
        set_name(font, 2, style)
        set_name(font, 4, f"{family} {style}")
        set_name(font, 6, postscript)
        if "OS/2" in font:
            font["OS/2"].usWeightClass = weight
            font["OS/2"].fsSelection &= ~0x61
            if weight >= 700:
                font["OS/2"].fsSelection |= 0x20
            else:
                font["OS/2"].fsSelection |= 0x40
        if "head" in font:
            font["head"].macStyle = 1 if weight >= 700 else 0
        output = OUTPUT / f"Geologica-{style.replace(' ', '')}.ttf"
        font.save(output, reorderTables=True)
        print(output)


if __name__ == "__main__":
    main()

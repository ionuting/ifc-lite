"""IFC Configuration — încarcă din Parquet, generează la prima rulare
====================================================================
Separă configurația (categorii, tipuri excluse, mapare relații) de cod.

Parquet-uri gestionate:
  assets/data/ifc_categories.parquet    — Category, IfcClass
  assets/data/ifc_skip_types.parquet    — IfcClass
  assets/data/ifc_rel_attr_map.parquet  — RelType, SrcIdx, TgtIdx

Utilizare:
  from ifc_config import load_config, all_node_types, type_to_cat
  categories, skip_types, rel_attr_map = load_config()
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

_HERE    = Path(__file__).parent.parent
DATA_DIR = _HERE / "assets" / "data"

CATEGORIES_PARQUET   = DATA_DIR / "ifc_categories.parquet"
SKIP_TYPES_PARQUET   = DATA_DIR / "ifc_skip_types.parquet"
REL_ATTR_MAP_PARQUET = DATA_DIR / "ifc_rel_attr_map.parquet"

# ---------------------------------------------------------------------------
# Built-in defaults — folosite O SINGURĂ DATĂ la generarea parquet-urilor
# Editați parquet-urile direct pentru a personaliza comportamentul.
# ---------------------------------------------------------------------------
_DEFAULT_CATEGORIES: dict[str, list[str]] = {
    "walls":    ["IFCWALL", "IFCWALLSTANDARDCASE"],
    "slabs":    ["IFCSLAB"],
    "doors":    ["IFCDOOR"],
    "windows":  ["IFCWINDOW"],
    "openings": ["IFCOPENINGELEMENT"],
    "coverings":["IFCCOVERING"],
    "columns":  ["IFCCOLUMN"],
    "beams":    ["IFCBEAM"],
    "roofs":    ["IFCROOF"],
    "stairs":   ["IFCSTAIR", "IFCSTAIRFLIGHT"],
    "ramps":    ["IFCRAMP", "IFCRAMPFLIGHT"],
    "spaces":   ["IFCSPACE"],
    "spatial":  ["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY"],
    "mep":      ["IFCFLOWSEGMENT", "IFCPIPESEGMENT", "IFCDUCTFITTING",
                 "IFCPIPEFITTING", "IFCFLOWFITTING", "IFCFLOWCONTROLLER",
                 "IFCFLOWTERMINAL"],
    "other":    ["IFCBUILDINGELEMENTPROXY", "IFCPLATE", "IFCMEMBER",
                 "IFCRAILING", "IFCFOOTING", "IFCPILE", "IFCCURTAINWALL",
                 "IFCANNOTATION", "IFCGRID"],
}

_DEFAULT_SKIP_TYPES: list[str] = [
    "IFCFURNISHINGELEMENT",
    "IFCFURNITURE",
    "IFCSYSTEMFURNITUREELEMENT",
]

_DEFAULT_REL_ATTR_MAP: list[tuple[str, int, int]] = [
    ("IFCRELAGGREGATES",                   4, 5),
    ("IFCRELCONTAINEDINSPATIALSTRUCTURE",   5, 4),
    ("IFCRELVOIDSELEMENT",                  4, 5),
    ("IFCRELFILLSELEMENT",                  4, 5),
    ("IFCRELCONNECTSELEMENTS",              5, 6),
    ("IFCRELASSOCIATESMATERIAL",            5, 4),
    ("IFCRELDEFINESBYPROPERTIES",           5, 4),
    ("IFCRELDEFINESBYTYPE",                 4, 5),
    ("IFCRELSPACEBOUNDARY",                 5, 4),
    ("IFCRELCOVERSBLDGELEMENTS",            4, 5),
    ("IFCRELCOVERSSPACE",                   4, 5),
    ("IFCRELPROJECTSELEMENT",               4, 5),
    ("IFCRELSEQUENCE",                      4, 5),
    ("IFCRELASSIGNSTOGROUP",                4, 5),
    ("IFCRELASSIGNSTOPRODUCT",              4, 5),
    ("IFCRELSERVICESBUILDINGS",             4, 5),
    ("IFCRELCONNECTSPATHELEMENTS",          5, 7),
    ("IFCRELCONNECTSSTRUCTURALMEMBER",      4, 5),
    ("IFCRELFLOWCONTROLELEMENTS",           4, 5),
]


# ---------------------------------------------------------------------------
# Generare parquet-uri
# ---------------------------------------------------------------------------
def generate_config_parquets(force: bool = False) -> None:
    """Generează parquet-urile de configurare din valorile implicite.
    Rulează automat la primul import dacă fișierele lipsesc.
    Folosiți force=True pentru a reseta la valorile implicite.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if force or not CATEGORIES_PARQUET.exists():
        rows = [
            {"Category": cat, "IfcClass": cls}
            for cat, classes in _DEFAULT_CATEGORIES.items()
            for cls in classes
        ]
        pd.DataFrame(rows, columns=["Category", "IfcClass"]).to_parquet(
            CATEGORIES_PARQUET, index=False
        )
        print(f"  Config parquet generated: {CATEGORIES_PARQUET.name}", flush=True)

    if force or not SKIP_TYPES_PARQUET.exists():
        pd.DataFrame({"IfcClass": _DEFAULT_SKIP_TYPES}).to_parquet(
            SKIP_TYPES_PARQUET, index=False
        )
        print(f"  Config parquet generated: {SKIP_TYPES_PARQUET.name}", flush=True)

    if force or not REL_ATTR_MAP_PARQUET.exists():
        pd.DataFrame(
            _DEFAULT_REL_ATTR_MAP, columns=["RelType", "SrcIdx", "TgtIdx"]
        ).to_parquet(REL_ATTR_MAP_PARQUET, index=False)
        print(f"  Config parquet generated: {REL_ATTR_MAP_PARQUET.name}", flush=True)


# ---------------------------------------------------------------------------
# Încărcare
# ---------------------------------------------------------------------------
def load_config() -> tuple[
    dict[str, list[str]],   # categories
    set[str],                # skip_types
    dict[str, tuple[int, int]],  # rel_attr_map
]:
    """Încarcă configurarea din parquet-uri (le generează dacă lipsesc).

    Returns
    -------
    categories   : {category_name: [IfcClass, ...]}
    skip_types   : {IfcClass, ...}   — tipuri excluse complet
    rel_attr_map : {RelType: (src_idx, tgt_idx)}
    """
    generate_config_parquets()

    df_cat = pd.read_parquet(CATEGORIES_PARQUET)
    categories: dict[str, list[str]] = {}
    for _, row in df_cat.iterrows():
        categories.setdefault(str(row["Category"]), []).append(str(row["IfcClass"]))

    skip_types: set[str] = set(
        pd.read_parquet(SKIP_TYPES_PARQUET)["IfcClass"].tolist()
    )

    df_rel = pd.read_parquet(REL_ATTR_MAP_PARQUET)
    rel_attr_map: dict[str, tuple[int, int]] = {
        str(row["RelType"]): (int(row["SrcIdx"]), int(row["TgtIdx"]))
        for _, row in df_rel.iterrows()
    }

    return categories, skip_types, rel_attr_map


def all_node_types(categories: dict[str, list[str]]) -> set[str]:
    """Toate tipurile IFC care sunt noduri (uniunea tuturor categoriilor)."""
    return {cls for classes in categories.values() for cls in classes}


def type_to_cat_map(categories: dict[str, list[str]]) -> dict[str, str]:
    """Lookup invers: IfcClass → Category."""
    return {cls: cat for cat, classes in categories.items() for cls in classes}


# ---------------------------------------------------------------------------
# CLI helper — regenerare manuală
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    force = "--force" in sys.argv
    generate_config_parquets(force=force)
    print("Parquet-urile de configurare sunt actualizate.")
    print(f"  Locație: {DATA_DIR}")

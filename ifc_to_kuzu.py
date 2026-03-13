"""IFC text → KuzuDB (fără ifcopenshell)
=======================================
Parsează fișierul IFC/STEP ca text simplu și scrie direct în KuzuDB
(o bază de date grafuri embedded).

Configurarea (categorii, tipuri excluse, mapare relații) este citită din:
  assets/data/ifc_categories.parquet
  assets/data/ifc_skip_types.parquet
  assets/data/ifc_rel_attr_map.parquet
Fișierele sunt generate automat la prima rulare dacă nu există.

Tabele KuzuDB generate:
  IfcElement  — noduri cu metadate
  Relation    — relații dintre noduri
  StepLine    — toate entitățile STEP
  Material    — materiale (nume, categorie, grosime strat)
  ColourRGB   — culori RGB + transparență per suprafață
  ElementMaterial — relație element → material
  ElementColour   — relație element → culoare (via lanț styles)

Dependințe: pandas pyarrow kuzu
Utilizare:  python schema/ifc_to_kuzu.py
"""
from __future__ import annotations
import re
import shutil
import sys
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from ifc_config import load_config, all_node_types, type_to_cat_map

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent.parent
IFC_PATH = _HERE / "ifc model" / "Fertighaus_ifc4.ifc"
DB_DIR   = _HERE / "kuzu_db"



# ---------------------------------------------------------------------------
# STEP tokenizer
# ---------------------------------------------------------------------------
_TOK_RE = re.compile(
    r"'(?:[^'\\]|\\.)*'"
    r"|#\d+"
    r"|\.[A-Z0-9_]+\."
    r"|[-+]?\d+\.\d+(?:[Ee][-+]?\d+)?"
    r"|[-+]?\d+"
    r"|\$"
    r"|\*"
    r"|[(),]"
)

def tokenize(s: str) -> list[str]:
    return _TOK_RE.findall(s)

def parse_attr_list(tokens: list[str], pos: int = 0) -> tuple[list, int]:
    result = []
    if pos < len(tokens) and tokens[pos] == "(":
        pos += 1
    while pos < len(tokens):
        tok = tokens[pos]
        if tok == ")":
            pos += 1
            break
        elif tok == ",":
            pos += 1
        elif tok == "(":
            sub, pos = parse_attr_list(tokens, pos)
            result.append(sub)
        elif tok in ("$", "*"):
            result.append(None)
            pos += 1
        elif tok.startswith("#"):
            result.append(tok)
            pos += 1
        elif tok.startswith("'"):
            result.append(tok[1:-1].replace("\\'", "'").replace("\\\\", "\\"))
            pos += 1
        elif tok.startswith("."):
            result.append(tok.strip("."))
            pos += 1
        else:
            try:
                result.append(int(tok))
            except ValueError:
                try:
                    result.append(float(tok))
                except ValueError:
                    result.append(tok)
            pos += 1
    return result, pos

def safe_get(lst: list, i: int, default=None):
    try:
        v = lst[i]
        return v if v is not None else default
    except IndexError:
        return default

def refs_in(attrs: list) -> list[str]:
    result = []
    for a in attrs:
        if isinstance(a, str) and a.startswith("#"):
            result.append(a)
        elif isinstance(a, list):
            result.extend(refs_in(a))
    return result

# ---------------------------------------------------------------------------
# Parser principal
# ---------------------------------------------------------------------------
_LINE_RE = re.compile(r"^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\((.+)\)\s*;\s*$")

def parse_ifc_file(path: Path) -> dict[int, dict]:
    print(f"Reading {path} ...", flush=True)
    entities: dict[int, dict] = {}
    in_data = False
    pending = ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw_line in fh:
            line = raw_line.rstrip("\r\n")
            if not in_data:
                if line.strip().upper() == "DATA;":
                    in_data = True
                continue
            if line.strip().upper() in ("ENDSEC;", "END-ISO-10303-21;"):
                break
            pending = (pending + " " + line.strip()) if pending else line.strip()
            if not pending.endswith(";"):
                continue
            m = _LINE_RE.match(pending)
            pending = ""
            if not m:
                continue
            eid   = int(m.group(1))
            etype = m.group(2).upper()
            raw   = m.group(3)
            tokens = tokenize(raw)
            attrs, _ = parse_attr_list(tokens)
            entities[eid] = {"type": etype, "attrs": attrs, "body": f"{etype}({raw})"}
    print(f"  Parsed {len(entities)} STEP entities.", flush=True)
    return entities

# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------
def build_nodes(
    entities: dict[int, dict],
    node_types: set[str],
    skip_types: set[str],
    type_to_cat: dict[str, str],
) -> pd.DataFrame:
    rows = []
    for eid, ent in entities.items():
        etype = ent["type"]
        if etype not in node_types or etype in skip_types:
            continue
        attrs = ent["attrs"]
        global_id     = safe_get(attrs, 0)
        name          = safe_get(attrs, 2)
        desc          = safe_get(attrs, 3)
        placement_ref = safe_get(attrs, 5)
        rep_ref       = safe_get(attrs, 6)
        rows.append({
            "LocalId":      eid,
            "GlobalId":     global_id if isinstance(global_id, str) else None,
            "IfcClass":     etype,
            "Category":     type_to_cat.get(etype, "other"),
            "Name":         name if isinstance(name, str) else None,
            "Description":  desc if isinstance(desc, str) else None,
            "PlacementRef": placement_ref if isinstance(placement_ref, str) and placement_ref.startswith("#") else None,
            "RepRef":       rep_ref if isinstance(rep_ref, str) and rep_ref.startswith("#") else None,
            "StepBody":     ent["body"],
        })
    df = pd.DataFrame(rows, columns=["LocalId","GlobalId","IfcClass","Category","Name","Description","PlacementRef","RepRef","StepBody"])
    print(f"  Nodes: {len(df)} rows", flush=True)
    return df

# ---------------------------------------------------------------------------
# Materials & Colours
# ---------------------------------------------------------------------------
# Lanț de rezolvare materiale:
#   IFCRELASSOCIATESMATERIAL(attrs[4]=element_list, attrs[5]=material_ref)
#   → IFCMATERIALLAYERSETUSAGE(attrs[0]=layerset_ref)
#   → IFCMATERIALLAYERSET(attrs[0]=layer_list)
#   → IFCMATERIALLAYER(attrs[0]=material_ref, attrs[1]=thickness)
#   → IFCMATERIAL(attrs[0]=name)
#
# Lanț culori:
#   IFCMATERIAL(id) → IFCMATERIALDEFINITIONREPRESENTATION(attrs[2]=reps, attrs[3]=material)
#   → IFCSTYLEDREPRESENTATION(attrs[3]=items)
#   → IFCSTYLEDITEM(attrs[1]=styles)
#   → IFCSURFACESTYLE(attrs[0]=name, attrs[2]=styles)
#   → IFCSURFACESTYLERENDERING(attrs[0]=colour_ref, attrs[1]=transparency)
#   → IFCCOLOURRGB(attrs[1]=R, attrs[2]=G, attrs[3]=B)

def build_materials(
    entities: dict[int, dict],
    node_ids: set[int],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Extrage materiale, culori și relațiile lor cu elemente.

    Returns
    -------
    df_mat          : Material(MatId, Name, Category, Thickness)
    df_colour       : ColourRGB(ColourId, R, G, B, Transparency, SurfaceStyleName)
    df_elem_mat     : ElementMaterial(LocalId, MatId, LayerOrder)
    df_elem_colour  : ElementColour(LocalId, ColourId)
    """

    def _eid(ref) -> int | None:
        if isinstance(ref, str) and ref.startswith("#"):
            return int(ref[1:])
        return None

    def _refs(val) -> list[int]:
        if isinstance(val, str) and val.startswith("#"):
            return [int(val[1:])]
        if isinstance(val, list):
            return [int(x[1:]) for x in val if isinstance(x, str) and x.startswith("#")]
        return []

    # --- index entități utile ---
    def _ent(eid: int | None) -> dict | None:
        return entities.get(eid) if eid is not None else None

    # 1. Rezolvă IFCCOLOURRGB → dict {colour_id: (R,G,B)}
    colours: dict[int, tuple[float, float, float]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCCOLOURRGB":
            a = ent["attrs"]
            try:
                colours[eid] = (float(a[1]), float(a[2]), float(a[3]))
            except (IndexError, TypeError, ValueError):
                pass

    # 2. Rezolvă IFCSURFACESTYLERENDERING → dict {rendering_id: (colour_id, transparency)}
    renderings: dict[int, tuple[int, float]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCSURFACESTYLERENDERING":
            a = ent["attrs"]
            cid = _eid(safe_get(a, 0))
            transp_raw = safe_get(a, 1)
            transp = float(transp_raw) if isinstance(transp_raw, (int, float)) else 0.0
            if cid and cid in colours:
                renderings[eid] = (cid, transp)

    # 3. IFCSURFACESTYLE → dict {style_id: (name, rendering_id)}
    surface_styles: dict[int, tuple[str, int | None]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCSURFACESTYLE":
            a = ent["attrs"]
            name = safe_get(a, 0) or ""
            name = name if isinstance(name, str) else ""
            for rid in _refs(safe_get(a, 2)):
                if rid in renderings:
                    surface_styles[eid] = (name, rid)
                    break
            else:
                surface_styles[eid] = (name, None)

    # 4. IFCSTYLEDITEM → dict {item_id: [surface_style_ids]}
    styled_items: dict[int, list[int]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCSTYLEDITEM":
            a = ent["attrs"]
            styled_items[eid] = [s for s in _refs(safe_get(a, 1)) if s in surface_styles]

    # 5. IFCSTYLEDREPRESENTATION → dict {repr_id: [surface_style_ids]}
    styled_reps: dict[int, list[int]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCSTYLEDREPRESENTATION":
            a = ent["attrs"]
            styles: list[int] = []
            for item_id in _refs(safe_get(a, 3)):
                styles.extend(styled_items.get(item_id, []))
            if styles:
                styled_reps[eid] = styles

    # 6. IFCMATERIALDEFINITIONREPRESENTATION → dict {mat_id: [surface_style_ids]}
    #                                          și {mat_id: def_rep_id}
    mat_to_styles: dict[int, list[int]] = {}
    mat_to_def_rep: dict[int, int] = {}  # mat_id → LocalId IFCMATERIALDEFINITIONREPRESENTATION
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALDEFINITIONREPRESENTATION":
            a = ent["attrs"]
            mat_id = _eid(safe_get(a, 3))
            if mat_id is None:
                continue
            styles: list[int] = []
            for rep_id in _refs(safe_get(a, 2)):
                styles.extend(styled_reps.get(rep_id, []))
            if styles:
                mat_to_styles[mat_id] = styles
            mat_to_def_rep[mat_id] = eid  # întotdeauna stocat, chiar fără styles

    # 7. IFCMATERIAL → dict {mat_id: name}
    ifc_materials: dict[int, str] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIAL":
            name = safe_get(ent["attrs"], 0)
            ifc_materials[eid] = name if isinstance(name, str) else ""

    # 8. Rezolvă IFCMATERIALLAYER → dict {layer_id: (mat_id, thickness)}
    layers: dict[int, tuple[int | None, float]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALLAYER":
            a = ent["attrs"]
            mat_id = _eid(safe_get(a, 0))
            thick_raw = safe_get(a, 1)
            thick = float(thick_raw) if isinstance(thick_raw, (int, float)) else 0.0
            layers[eid] = (mat_id, thick)

    # 9. IFCMATERIALLAYERSET → dict {set_id: [layer_ids]}
    layer_sets: dict[int, list[int]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALLAYERSET":
            a = ent["attrs"]
            layer_sets[eid] = _refs(safe_get(a, 0))

    # 10. IFCMATERIALLAYERSETUSAGE → dict {usage_id: set_id}
    layer_set_usages: dict[int, int] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALLAYERSETUSAGE":
            a = ent["attrs"]
            sid = _eid(safe_get(a, 0))
            if sid and sid in layer_sets:
                layer_set_usages[eid] = sid

    # 11. IFCMATERIALCONSTITUENT + SET → fallback simplificat
    mat_constituents: dict[int, int] = {}  # constituent_set_id → material_id
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALCONSTITUENT":
            a = ent["attrs"]
            mat_id = _eid(safe_get(a, 2))
            if mat_id:
                mat_constituents[eid] = mat_id
    constituent_sets: dict[int, list[int]] = {}
    for eid, ent in entities.items():
        if ent["type"] == "IFCMATERIALCONSTITUENTSET":
            a = ent["attrs"]
            constituent_sets[eid] = _refs(safe_get(a, 2))

    # 12. IFCRELASSOCIATESMATERIAL: element_ids → material ref
    #     attrs[4] = entity_list, attrs[5] = material_ref
    rows_mat: list[dict] = []
    rows_colour: list[dict] = []
    rows_elem_mat: list[dict] = []
    rows_elem_colour: list[dict] = []

    seen_mats: dict[int, int] = {}      # mat_id → MatId (row index)
    seen_colours: dict[int, int] = {}   # surface_style_id → ColourId (row index)

    def _ensure_colour(style_id: int) -> int:
        if style_id in seen_colours:
            return seen_colours[style_id]
        cid = len(rows_colour)
        seen_colours[style_id] = cid
        style_name, rend_id = surface_styles.get(style_id, ("", None))
        r = g = b = 0.0
        transp = 0.0
        if rend_id and rend_id in renderings:
            colour_id, transp = renderings[rend_id]
            r, g, b = colours.get(colour_id, (0.0, 0.0, 0.0))
        rows_colour.append({
            "ColourId": cid,
            "SurfaceStyleId": style_id,
            "SurfaceStyleName": style_name,
            "R": r, "G": g, "B": b,
            "Transparency": transp,
        })
        return cid

    def _ensure_mat(mat_id: int, layer_order: int, thickness: float) -> int:
        key = (mat_id, layer_order)
        if key in seen_mats:
            return seen_mats[key]
        mid = len(rows_mat)
        seen_mats[key] = mid
        name = ifc_materials.get(mat_id, "")
        rows_mat.append({
            "MatId":       mid,
            "IFCMatId":    mat_id,
            "Name":        name,
            "LayerOrder":  layer_order,
            "Thickness":   thickness,
            "MatDefRepId": mat_to_def_rep.get(mat_id, -1),
        })
        return mid

    for eid, ent in entities.items():
        if ent["type"] != "IFCRELASSOCIATESMATERIAL":
            continue
        a = ent["attrs"]
        elem_ids = _refs(safe_get(a, 4))
        elem_ids = [e for e in elem_ids if e in node_ids]
        if not elem_ids:
            continue
        mat_ref = _eid(safe_get(a, 5))
        if mat_ref is None:
            continue

        mat_ent = _ent(mat_ref)
        if mat_ent is None:
            continue
        mtype = mat_ent["type"]

        # Rezolvă lista de (mat_id, thickness, order)
        mat_layer_list: list[tuple[int, float, int]] = []

        if mtype == "IFCMATERIALLAYERSETUSAGE":
            sid = layer_set_usages.get(mat_ref)
            if sid:
                for order, lid in enumerate(layer_sets.get(sid, [])):
                    m_id, thick = layers.get(lid, (None, 0.0))
                    if m_id:
                        mat_layer_list.append((m_id, thick, order))
        elif mtype == "IFCMATERIALLAYERSET":
            for order, lid in enumerate(layer_sets.get(mat_ref, [])):
                m_id, thick = layers.get(lid, (None, 0.0))
                if m_id:
                    mat_layer_list.append((m_id, thick, order))
        elif mtype == "IFCMATERIALLAYER":
            m_id, thick = layers.get(mat_ref, (None, 0.0))
            if m_id:
                mat_layer_list.append((m_id, thick, 0))
        elif mtype == "IFCMATERIAL":
            mat_layer_list.append((mat_ref, 0.0, 0))
        elif mtype == "IFCMATERIALCONSTITUENTSET":
            for order, cid in enumerate(constituent_sets.get(mat_ref, [])):
                m_id = mat_constituents.get(cid)
                if m_id:
                    mat_layer_list.append((m_id, 0.0, order))
        elif mtype == "IFCMATERIALCONSTITUENT":
            m_id = mat_constituents.get(mat_ref)
            if m_id:
                mat_layer_list.append((m_id, 0.0, 0))

        for elem_id in elem_ids:
            for m_id, thick, order in mat_layer_list:
                mid = _ensure_mat(m_id, order, thick)
                rows_elem_mat.append({
                    "LocalId": elem_id,
                    "MatId": mid,
                    "LayerOrder": order,
                    "AssocRelStepId": eid,  # LocalId al IFCRELASSOCIATESMATERIAL
                })

                # Culori pentru material
                for style_id in mat_to_styles.get(m_id, []):
                    col_id = _ensure_colour(style_id)
                    rows_elem_colour.append({"LocalId": elem_id, "ColourId": col_id})

    # Deduplică elem_colour (un element poate apărea de mai multe ori dacă are layere)
    seen_ec: set[tuple] = set()
    dedup_ec = []
    for row in rows_elem_colour:
        key = (row["LocalId"], row["ColourId"])
        if key not in seen_ec:
            seen_ec.add(key)
            dedup_ec.append(row)

    df_mat = pd.DataFrame(rows_mat,
        columns=["MatId", "IFCMatId", "Name", "LayerOrder", "Thickness", "MatDefRepId"])
    df_colour = pd.DataFrame(rows_colour,
        columns=["ColourId", "SurfaceStyleId", "SurfaceStyleName", "R", "G", "B", "Transparency"])
    df_elem_mat = pd.DataFrame(rows_elem_mat,
        columns=["LocalId", "MatId", "LayerOrder", "AssocRelStepId"])
    df_elem_colour = pd.DataFrame(dedup_ec,
        columns=["LocalId", "ColourId"])

    print(f"  Materials: {len(df_mat)} rows", flush=True)
    print(f"  Colours:   {len(df_colour)} rows", flush=True)
    print(f"  ElemMat:   {len(df_elem_mat)} rows", flush=True)
    print(f"  ElemColour:{len(df_elem_colour)} rows", flush=True)
    return df_mat, df_colour, df_elem_mat, df_elem_colour


# ---------------------------------------------------------------------------
# Edges — Kuzu expects explicit Src/Tgt per row (one edge per row)
# ---------------------------------------------------------------------------
def _flatten_refs(val) -> list[str]:
    if val is None:
        return []
    if isinstance(val, str) and val.startswith("#"):
        return [val]
    if isinstance(val, list):
        return [x for x in val if isinstance(x, str) and x.startswith("#")]
    return []

def build_edges(
    entities: dict[int, dict],
    rel_attr_map: dict[str, tuple[int, int]],
) -> pd.DataFrame:
    rows = []
    for eid, ent in entities.items():
        etype = ent["type"]
        if not etype.startswith("IFCREL"):
            continue
        attrs = ent["attrs"]
        global_id = safe_get(attrs, 0)
        global_id = global_id if isinstance(global_id, str) else None
        a_idx, b_idx = rel_attr_map.get(etype, (4, 5))
        srcs = _flatten_refs(safe_get(attrs, a_idx))
        tgts = _flatten_refs(safe_get(attrs, b_idx))
        if srcs and tgts:
            for src in srcs:
                for tgt in tgts:
                    rows.append({"RelId": eid, "RelType": etype, "GlobalId": global_id,
                                 "Src": int(src[1:]), "Tgt": int(tgt[1:])})
        else:
            all_refs = refs_in(attrs[4:]) if len(attrs) > 4 else []
            rows.append({"RelId": eid, "RelType": etype, "GlobalId": global_id,
                         "Src": int(all_refs[0][1:]) if len(all_refs) > 0 else None,
                         "Tgt": int(all_refs[1][1:]) if len(all_refs) > 1 else None})
    df = pd.DataFrame(rows, columns=["RelId","RelType","GlobalId","Src","Tgt"])
    print(f"  Edges: {len(df)} rows", flush=True)
    return df

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    try:
        import kuzu
    except ImportError:
        raise SystemExit("kuzu nu este instalat. Rulați: pip install kuzu")

    print("Încărcare configurare din parquet-uri ...", flush=True)
    categories, skip_types, rel_attr_map = load_config()
    node_types  = all_node_types(categories)
    type_to_cat = type_to_cat_map(categories)
    print(f"  {len(categories)} categorii, {len(node_types)} tipuri IFC, "
          f"{len(skip_types)} tipuri excluse, {len(rel_attr_map)} relații mapate",
          flush=True)

    entities = parse_ifc_file(IFC_PATH)
    nodes = build_nodes(entities, node_types, skip_types, type_to_cat)
    edges = build_edges(entities, rel_attr_map)
    node_ids = set(nodes["LocalId"].tolist())
    df_mat, df_colour, df_elem_mat, df_elem_colour = build_materials(entities, node_ids)

    # Normalize: kuzu STRING nu acceptă None
    for col in ["GlobalId", "Name", "Description", "PlacementRef", "RepRef", "Category", "StepBody"]:
        nodes[col] = nodes[col].fillna("")
    for col in ["GlobalId", "RelType"]:
        edges[col] = edges[col].fillna("")
    edges = edges.dropna(subset=["Src", "Tgt"])
    edges["Src"] = edges["Src"].astype("int64")
    edges["Tgt"] = edges["Tgt"].astype("int64")
    nodes["LocalId"] = nodes["LocalId"].astype("int64")

    # Recreează baza de date (șterge dacă există — kuzu creează singur directorul)
    for p in DB_DIR.parent.glob(DB_DIR.name + "*"):
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()

    db   = kuzu.Database(str(DB_DIR))
    conn = kuzu.Connection(db)

    conn.execute("""
        CREATE NODE TABLE IfcElement(
            LocalId      INT64,
            GlobalId     STRING,
            IfcClass     STRING,
            Category     STRING,
            Name         STRING,
            Description  STRING,
            PlacementRef STRING,
            RepRef       STRING,
            StepBody     STRING,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE REL TABLE Relation(
            FROM IfcElement TO IfcElement,
            RelId    INT64,
            RelType  STRING,
            GlobalId STRING
        )
    """)
    conn.execute("""
        CREATE NODE TABLE StepLine(
            LocalId  INT64,
            StepBody STRING,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE Material(
            MatId      INT64,
            IFCMatId   INT64,
            Name       STRING,
            LayerOrder INT64,
            Thickness  DOUBLE,
            MatDefRepId INT64,
            PRIMARY KEY (MatId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE ColourRGB(
            ColourId         INT64,
            SurfaceStyleId   INT64,
            SurfaceStyleName STRING,
            R                DOUBLE,
            G                DOUBLE,
            B                DOUBLE,
            Transparency     DOUBLE,
            PRIMARY KEY (ColourId)
        )
    """)
    conn.execute("""
        CREATE REL TABLE HasMaterial(
            FROM IfcElement TO Material,
            LayerOrder      INT64,
            AssocRelStepId  INT64
        )
    """)
    conn.execute("""
        CREATE REL TABLE HasColour(
            FROM IfcElement TO ColourRGB
        )
    """)

    # Bulk-load nodes din pandas DataFrame
    conn.execute(
        "COPY IfcElement FROM (LOAD FROM $nodes_df RETURN *)",
        {"nodes_df": nodes}
    )
    print(f"  Nodes inserted: {len(nodes)}", flush=True)

    # Edges: COPY REL așteaptă col. (from_pk, to_pk, props...)
    valid_ids = set(nodes["LocalId"])
    edges_ok = edges[
        edges["Src"].isin(valid_ids) & edges["Tgt"].isin(valid_ids)
    ].copy()
    edges_ok = edges_ok.rename(columns={"Src": "from", "Tgt": "to"})[
        ["from", "to", "RelId", "RelType", "GlobalId"]
    ]
    conn.execute(
        "COPY Relation FROM (LOAD FROM $edges_df RETURN *)",
        {"edges_df": edges_ok}
    )
    print(f"  Edges inserted:  {len(edges_ok)}", flush=True)

    # StepLine: toate entitățile STEP (pentru reconstrucție fără IFC original)
    step_rows = [
        {"LocalId": eid, "StepBody": ent["body"]}
        for eid, ent in entities.items()
        if ent["type"] not in skip_types
    ]
    step_df = pd.DataFrame(step_rows, columns=["LocalId", "StepBody"])
    step_df["LocalId"] = step_df["LocalId"].astype("int64")
    conn.execute(
        "COPY StepLine FROM (LOAD FROM $step_df RETURN *)",
        {"step_df": step_df}
    )
    print(f"  StepLine inserted: {len(step_df)}", flush=True)

    # Material, ColourRGB, HasMaterial, HasColour
    if not df_mat.empty:
        df_mat["MatId"]       = df_mat["MatId"].astype("int64")
        df_mat["IFCMatId"]    = df_mat["IFCMatId"].astype("int64")
        df_mat["LayerOrder"]  = df_mat["LayerOrder"].astype("int64")
        df_mat["Thickness"]   = df_mat["Thickness"].astype("float64")
        df_mat["MatDefRepId"] = df_mat["MatDefRepId"].astype("int64")
        df_mat["Name"]        = df_mat["Name"].fillna("")
        conn.execute(
            "COPY Material FROM (LOAD FROM $df RETURN *)",
            {"df": df_mat}
        )
        print(f"  Material inserted: {len(df_mat)}", flush=True)

    if not df_colour.empty:
        df_colour["ColourId"]       = df_colour["ColourId"].astype("int64")
        df_colour["SurfaceStyleId"] = df_colour["SurfaceStyleId"].astype("int64")
        df_colour["SurfaceStyleName"] = df_colour["SurfaceStyleName"].fillna("")
        for col in ["R", "G", "B", "Transparency"]:
            df_colour[col] = df_colour[col].astype("float64")
        conn.execute(
            "COPY ColourRGB FROM (LOAD FROM $df RETURN *)",
            {"df": df_colour}
        )
        print(f"  ColourRGB inserted: {len(df_colour)}", flush=True)

    if not df_elem_mat.empty:
        valid_mat_ids = set(df_mat["MatId"].tolist()) if not df_mat.empty else set()
        em_ok = df_elem_mat[
            df_elem_mat["LocalId"].isin(valid_ids) &
            df_elem_mat["MatId"].isin(valid_mat_ids)
        ].copy()
        em_ok["LayerOrder"] = em_ok["LayerOrder"].astype("int64")
        em_ok["AssocRelStepId"] = em_ok["AssocRelStepId"].astype("int64")
        em_ok = em_ok.rename(columns={"LocalId": "from", "MatId": "to"})[
            ["from", "to", "LayerOrder", "AssocRelStepId"]
        ]
        conn.execute(
            "COPY HasMaterial FROM (LOAD FROM $df RETURN *)",
            {"df": em_ok}
        )
        print(f"  HasMaterial inserted: {len(em_ok)}", flush=True)

    if not df_elem_colour.empty:
        valid_col_ids = set(df_colour["ColourId"].tolist()) if not df_colour.empty else set()
        ec_ok = df_elem_colour[
            df_elem_colour["LocalId"].isin(valid_ids) &
            df_elem_colour["ColourId"].isin(valid_col_ids)
        ].copy()
        ec_ok = ec_ok.rename(columns={"LocalId": "from", "ColourId": "to"})[
            ["from", "to"]
        ]
        conn.execute(
            "COPY HasColour FROM (LOAD FROM $df RETURN *)",
            {"df": ec_ok}
        )
        print(f"  HasColour inserted: {len(ec_ok)}", flush=True)

    # ── Geometrie pre-computată (ifcopenshell, opțional) ─────────────────────
    # Rulat O singura dată la import; stocheaza vertices+indices+color per element
    # Permite endpoint-ul /api/kuzu/geometry-direct fara ifcopenshell la runtime.
    _write_geometry_table(conn, nodes, IFC_PATH)

    print(f"Done. KuzuDB at: {DB_DIR}", flush=True)


def _get_default_color(ifc_type: str) -> list[float]:
    """Culori implicite per tip IFC (R, G, B, A)."""
    _COLORS = {
        "IFCWALL":              [0.85, 0.82, 0.76, 1.0],
        "IFCWALLSTANDARDCASE":  [0.85, 0.82, 0.76, 1.0],
        "IFCSLAB":              [0.70, 0.70, 0.70, 1.0],
        "IFCDOOR":              [0.55, 0.40, 0.25, 1.0],
        "IFCWINDOW":            [0.60, 0.80, 0.95, 0.5],
        "IFCOPENINGELEMENT":    [0.90, 0.50, 0.50, 0.3],
        "IFCCOLUMN":            [0.75, 0.75, 0.80, 1.0],
        "IFCBEAM":              [0.65, 0.65, 0.70, 1.0],
        "IFCSLAB":              [0.70, 0.70, 0.70, 1.0],
        "IFCROOF":              [0.60, 0.45, 0.35, 1.0],
        "IFCSTAIR":             [0.80, 0.75, 0.65, 1.0],
        "IFCSTAIRFLIGHT":       [0.80, 0.75, 0.65, 1.0],
    }
    return _COLORS.get(ifc_type.upper(), [0.70, 0.70, 0.70, 1.0])


def _write_geometry_table(conn, df_nodes: pd.DataFrame, ifc_path: Path) -> None:
    """Calculeaza geometria 3D cu ifcopenshell si o stocheaza in KuzuDB (ElementGeometry)."""
    import json, time as _t
    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError:
        print("  [geom] ifcopenshell nu e instalat — ElementGeometry ignorata.", flush=True)
        return

    if not ifc_path.exists():
        print(f"  [geom] IFC nu gasit: {ifc_path}", flush=True)
        return

    t0 = _t.time()
    print("  [geom] Calcul geometrie cu ifcopenshell ...", flush=True)

    try:
        ifc = ifcopenshell.open(str(ifc_path))
    except Exception as e:
        print(f"  [geom] ifcopenshell.open FAILED: {e}", flush=True)
        return

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    # Construim un index GlobalId → LocalId din df_nodes
    gid_to_lid = {}
    for _, row in df_nodes.iterrows():
        if row["GlobalId"]:
            gid_to_lid[row["GlobalId"]] = int(row["LocalId"])

    rows = []
    ok = 0
    for product in ifc.by_type("IfcProduct"):
        if not product.Representation:
            continue
        gid = product.GlobalId
        lid = gid_to_lid.get(gid)
        if lid is None:
            continue
        try:
            shape    = ifcopenshell.geom.create_shape(settings, product)
            geo      = shape.geometry
            verts    = list(geo.verts)
            indices  = list(geo.faces)
            color    = _get_default_color(product.is_a())
            geom_obj = {"v": verts, "i": indices, "c": color}
            rows.append({
                "LocalId":  lid,
                "GlobalId": gid,
                "GeomJSON": json.dumps(geom_obj, separators=(",", ":")),
            })
            ok += 1
        except Exception:
            pass

    if not rows:
        print("  [geom] Nicio geometrie calculata.", flush=True)
        return

    df_geom = pd.DataFrame(rows)
    df_geom["LocalId"]  = df_geom["LocalId"].astype("int64")
    df_geom["GlobalId"] = df_geom["GlobalId"].astype(str)
    df_geom["GeomJSON"] = df_geom["GeomJSON"].astype(str)

    # Recreaza tabela (idempotent)
    try:
        conn.execute("DROP TABLE IF EXISTS ElementGeometry")
    except Exception:
        pass
    conn.execute(
        "CREATE NODE TABLE ElementGeometry("
        "LocalId INT64, GlobalId STRING, GeomJSON STRING, PRIMARY KEY(LocalId))"
    )
    conn.execute(
        "COPY ElementGeometry FROM (LOAD FROM $df RETURN *)",
        {"df": df_geom}
    )
    print(f"  [geom] ElementGeometry: {ok} elemente in {_t.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()

"""ifc_to_kuzu_v2.py — Schema v2 optimizată pentru transformări parametrice
============================================================================

Diferențe față de v1 (ifc_to_kuzu.py):
  • IfcElement  — fără StepBody / PlacementRef / RepRef / Description (space savings)
  • ElementGeom — înlocuiește ElementGeometry; GeomJSON spart în VertsJSON + FacesJSON
                   + color scalars (CR/CG/CB/CA) + bounding box (6 scalars)
                   → color/bbox queryabile fără json.loads
  • WallParam   — NOU: StartX/Y/Z, EndX/Y/Z, Length, Thickness, Height, StoreyLocalId
                   → transforms parametrice fără ifcopenshell la runtime
  • OpeningParam — NOU: HostWallLocalId, TAlongWall, Width, Height, SillZ, ElemType
                   → uși/ferestre cu poziție parametrică pe zid
  • Material    — color embeddată (CR/CG/CB/CA), fără MatDefRepId/IFCMatId duplicate
  • StepLine    — păstrat identic (reconstruct_from_kuzu.py are nevoie)
  • WallAdjacent — NOU REL typed: IfcElement→IfcElement (din IFCRELCONNECTSPATHELEMENTS)
  • Hosts        — NOU REL typed: IfcElement→IfcElement (void+fill elements)
  • InStorey     — NOU REL typed: IfcElement→IfcElement (element→BuildingStorey)
  • HasMaterial  — același ca v1, simplificat (fără AssocRelStepId)
  • Relation     — rămâne doar cu IFCRELSPACEBOUNDARY + IFCRELAGGREGATES (~245 edges)
  • ColourRGB / HasColour — ELIMINATE (color e acum în ElementGeom + Material)

Workflow granular (obiectivul principal):
  Transform wall X:
    1. MATCH (p:WallParam {LocalId:X})              → params scalari, PK lookup
    2. MATCH (w {LocalId:X})-[:WallAdjacent]-(adj)  → ziduri adiacente (1-hop)
    3. MATCH (w {LocalId:X})-[:Hosts]->(op)         → deschideri/uși/ferestre
    4. Recalculează geometrie parametric (fără ifcopenshell)
    5. Upsert ElementGeom + WallParam pentru elementele afectate
    6. Return doar geometriile modificate → frontend refresh granular

Dependințe: kuzu pandas numpy ifcopenshell
Utilizare:  python ifc_to_kuzu_v2.py
"""
from __future__ import annotations

import json
import shutil
import sys
import time as _time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

# Reutilizăm parserul și config-ul din v1 (nu duplicăm logica)
from ifc_to_kuzu import (
    parse_ifc_file,
    build_nodes,
    build_edges,
    build_materials,
    safe_get,
    _get_default_color,
)
from ifc_config import load_config, all_node_types, type_to_cat_map

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_HERE    = Path(__file__).parent.parent
IFC_PATH = _HERE / "ifc model" / "Fertighaus_ifc4.ifc"
DB_DIR   = _HERE / "kuzu_db"

V2_MARKER = "v2"  # prezent ca node WallParam → indică schema v2 activă


# ---------------------------------------------------------------------------
# Schema v2: creare tabele
# ---------------------------------------------------------------------------
def _create_v2_schema(conn) -> None:
    """Creează toate tabelele NODE și REL pentru schema v2."""

    # NODE tables
    conn.execute("""
        CREATE NODE TABLE IfcElement(
            LocalId  INT64,
            GlobalId STRING,
            IfcClass STRING,
            Category STRING,
            Name     STRING,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE ElementGeom(
            LocalId   INT64,
            GlobalId  STRING,
            VertsJSON STRING,
            FacesJSON STRING,
            CR DOUBLE, CG DOUBLE, CB DOUBLE, CA DOUBLE,
            BBoxMinX DOUBLE, BBoxMinY DOUBLE, BBoxMinZ DOUBLE,
            BBoxMaxX DOUBLE, BBoxMaxY DOUBLE, BBoxMaxZ DOUBLE,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE WallParam(
            LocalId      INT64,
            GlobalId     STRING,
            StartX DOUBLE, StartY DOUBLE, StartZ DOUBLE,
            EndX   DOUBLE, EndY   DOUBLE, EndZ   DOUBLE,
            Length DOUBLE, Thickness DOUBLE, Height DOUBLE,
            StoreyLocalId INT64,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE OpeningParam(
            LocalId         INT64,
            GlobalId        STRING,
            HostWallLocalId INT64,
            TAlongWall      DOUBLE,
            Width  DOUBLE, Height DOUBLE, SillZ DOUBLE,
            ElemType STRING,
            PRIMARY KEY (LocalId)
        )
    """)
    conn.execute("""
        CREATE NODE TABLE Material(
            MatId     INT64,
            Name      STRING,
            Thickness DOUBLE,
            CR DOUBLE, CG DOUBLE, CB DOUBLE, CA DOUBLE,
            PRIMARY KEY (MatId)
        )
    """)
    # REL tables (typed)
    conn.execute("CREATE REL TABLE WallAdjacent(FROM IfcElement TO IfcElement)")
    conn.execute("CREATE REL TABLE Hosts(FROM IfcElement TO IfcElement)")
    conn.execute("CREATE REL TABLE InStorey(FROM IfcElement TO IfcElement)")
    conn.execute("""
        CREATE REL TABLE HasMaterial(
            FROM IfcElement TO Material,
            LayerOrder INT64
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
    print("[v2] Schema creată.", flush=True)


# ---------------------------------------------------------------------------
# ElementGeom v2 (cu color scalars + bbox)
# ---------------------------------------------------------------------------
def _build_elem_geom_v2(conn, df_nodes: pd.DataFrame, ifc_path: Path) -> None:
    """Calculează geometrie cu ifcopenshell și scrie ElementGeom (v2)."""
    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError:
        print("  [v2-geom] ifcopenshell lipsă — ElementGeom ignorat.", flush=True)
        return

    if not ifc_path.exists():
        print(f"  [v2-geom] IFC negăsit: {ifc_path}", flush=True)
        return

    t0 = _time.time()
    print("  [v2-geom] Calculez geometrie cu ifcopenshell ...", flush=True)
    ifc = ifcopenshell.open(str(ifc_path))
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    gid_to_lid = {row["GlobalId"]: int(row["LocalId"])
                  for _, row in df_nodes.iterrows() if row["GlobalId"]}

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
            shape = ifcopenshell.geom.create_shape(settings, product)
            geo   = shape.geometry
            verts = list(geo.verts)
            faces = list(geo.faces)
            if not verts:
                continue

            # Bounding box
            pts     = np.array(verts).reshape(-1, 3)
            bbox_min = pts.min(axis=0)
            bbox_max = pts.max(axis=0)

            # Color din material IFC (cu fallback la default)
            cr, cg, cb, ca = _get_default_color(product.is_a())
            try:
                mats = geo.materials
                for mat_obj in (mats or []):
                    d = getattr(mat_obj, "diffuse", None)
                    if d is None:
                        continue
                    r, g, b = float(d.r()), float(d.g()), float(d.b())
                    if r == 0.0 and g == 0.0 and b == 0.0:
                        continue
                    transp = getattr(mat_obj, "transparency", 0.0)
                    cr, cg, cb = r, g, b
                    ca = max(0.0, min(1.0, 1.0 - float(transp)))
                    break
            except Exception:
                pass

            rows.append({
                "LocalId":   lid,
                "GlobalId":  gid,
                "VertsJSON": json.dumps(verts,  separators=(",", ":")),
                "FacesJSON": json.dumps(faces,  separators=(",", ":")),
                "CR": cr, "CG": cg, "CB": cb, "CA": ca,
                "BBoxMinX": float(bbox_min[0]), "BBoxMinY": float(bbox_min[1]), "BBoxMinZ": float(bbox_min[2]),
                "BBoxMaxX": float(bbox_max[0]), "BBoxMaxY": float(bbox_max[1]), "BBoxMaxZ": float(bbox_max[2]),
            })
            ok += 1
        except Exception:
            pass

    if not rows:
        print("  [v2-geom] Nicio geometrie calculată.", flush=True)
        return

    # Insert batch
    BATCH = 50
    for start in range(0, len(rows), BATCH):
        for row in rows[start: start + BATCH]:
            conn.execute(
                "CREATE (:ElementGeom {"
                "LocalId:$lid, GlobalId:$gid, VertsJSON:$vj, FacesJSON:$fj,"
                "CR:$cr, CG:$cg, CB:$cb, CA:$ca,"
                "BBoxMinX:$x0, BBoxMinY:$y0, BBoxMinZ:$z0,"
                "BBoxMaxX:$x1, BBoxMaxY:$y1, BBoxMaxZ:$z1"
                "})",
                {"lid": int(row["LocalId"]), "gid": str(row["GlobalId"]),
                 "vj": row["VertsJSON"], "fj": row["FacesJSON"],
                 "cr": row["CR"], "cg": row["CG"], "cb": row["CB"], "ca": row["CA"],
                 "x0": row["BBoxMinX"], "y0": row["BBoxMinY"], "z0": row["BBoxMinZ"],
                 "x1": row["BBoxMaxX"], "y1": row["BBoxMaxY"], "z1": row["BBoxMaxZ"]}
            )
    print(f"  [v2-geom] ElementGeom: {ok} elemente în {_time.time()-t0:.1f}s", flush=True)
    return rows  # returnăm pentru a fi reutilizat de _build_wall_params_v2


# ---------------------------------------------------------------------------
# WallParam v2
# ---------------------------------------------------------------------------
def _build_wall_params_v2(conn, df_nodes: pd.DataFrame, entities: dict,
                           ifc_path: Path) -> dict:
    """Extrage parametri scalari per zid și scrie WallParam.
    Returnează dict {local_id: row} pentru OpeningParam.
    """
    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError:
        print("  [v2-wallparam] ifcopenshell lipsă — WallParam ignorat.", flush=True)
        return {}

    if not ifc_path.exists():
        return {}

    t0 = _time.time()
    ifc = ifcopenshell.open(str(ifc_path))
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    # Index GlobalId → LocalId pentru ziduri
    wall_cats = {"walls"}
    gid_to_lid = {
        row["GlobalId"]: int(row["LocalId"])
        for _, row in df_nodes.iterrows()
        if row["GlobalId"] and row.get("Category", "") in wall_cats
    }

    # InStorey: LocalId element → LocalId storey (din IFCRELCONTAINEDINSPATIALSTRUCTURE)
    elem_to_storey: dict[int, int] = {}
    for eid, ent in entities.items():
        if ent["type"] != "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            continue
        a = ent["attrs"]
        struct_ref = safe_get(a, 5)
        if not (isinstance(struct_ref, str) and struct_ref.startswith("#")):
            continue
        storey_lid = int(struct_ref[1:])
        storey_ent = entities.get(storey_lid, {})
        if storey_ent.get("type") != "IFCBUILDINGSTOREY":
            continue
        elem_list = safe_get(a, 4)
        if not isinstance(elem_list, list):
            continue
        for ref in elem_list:
            if isinstance(ref, str) and ref.startswith("#"):
                elem_to_storey[int(ref[1:])] = storey_lid

    rows = []
    wp_dict: dict[int, dict] = {}

    for product in ifc.by_type("IfcWall") + ifc.by_type("IfcWallStandardCase"):
        gid = product.GlobalId
        lid = gid_to_lid.get(gid)
        if lid is None:
            continue
        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
            verts = np.array(list(shape.geometry.verts)).reshape(-1, 3)
            if len(verts) == 0:
                continue

            bbox_min = verts.min(axis=0)
            bbox_max = verts.max(axis=0)
            dx = float(bbox_max[0] - bbox_min[0])
            dy = float(bbox_max[1] - bbox_min[1])
            dz = float(bbox_max[2] - bbox_min[2])
            height = dz

            # Direcția zidului = axa dominantă în plan orizontal
            if dx >= dy:
                sx, sy = float(bbox_min[0]), float((bbox_min[1] + bbox_max[1]) / 2)
                ex, ey = float(bbox_max[0]), float((bbox_min[1] + bbox_max[1]) / 2)
                thickness, length = dy, dx
            else:
                sx, sy = float((bbox_min[0] + bbox_max[0]) / 2), float(bbox_min[1])
                ex, ey = float((bbox_min[0] + bbox_max[0]) / 2), float(bbox_max[1])
                thickness, length = dx, dy

            sz = float(bbox_min[2])
            ez = sz  # start și end la același nivel

            row = {
                "LocalId": lid, "GlobalId": gid,
                "StartX": sx, "StartY": sy, "StartZ": sz,
                "EndX":   ex, "EndY":   ey, "EndZ":   ez,
                "Length": length, "Thickness": thickness, "Height": height,
                "StoreyLocalId": elem_to_storey.get(lid, -1),
            }
            rows.append(row)
            wp_dict[lid] = row
        except Exception:
            pass

    if not rows:
        print("  [v2-wallparam] Niciun zid procesat.", flush=True)
        return {}

    # Insert batch
    BATCH = 100
    for start in range(0, len(rows), BATCH):
        for row in rows[start: start + BATCH]:
            conn.execute(
                "CREATE (:WallParam {"
                "LocalId:$lid, GlobalId:$gid,"
                "StartX:$sx, StartY:$sy, StartZ:$sz,"
                "EndX:$ex, EndY:$ey, EndZ:$ez,"
                "Length:$l, Thickness:$t, Height:$h,"
                "StoreyLocalId:$sid"
                "})",
                {"lid": int(row["LocalId"]), "gid": str(row["GlobalId"]),
                 "sx": row["StartX"], "sy": row["StartY"], "sz": row["StartZ"],
                 "ex": row["EndX"],   "ey": row["EndY"],   "ez": row["EndZ"],
                 "l":  row["Length"], "t":  row["Thickness"], "h": row["Height"],
                 "sid": int(row["StoreyLocalId"])}
            )
    print(f"  [v2-wallparam] WallParam: {len(rows)} ziduri în {_time.time()-t0:.1f}s", flush=True)
    return wp_dict


# ---------------------------------------------------------------------------
# OpeningParam v2
# ---------------------------------------------------------------------------
def _build_opening_params_v2(conn, df_nodes: pd.DataFrame, entities: dict,
                              ifc_path: Path, wp_dict: dict) -> None:
    """Extrage parametri parametrici per ușă/fereastră și scrie OpeningParam."""
    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError:
        return

    if not ifc_path.exists():
        return

    t0 = _time.time()
    ifc = ifcopenshell.open(str(ifc_path))
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    # Index: LocalId → Category și GlobalId → LocalId
    lid_to_cat = {int(row["LocalId"]): row.get("Category", "")
                  for _, row in df_nodes.iterrows()}
    gid_to_lid = {row["GlobalId"]: int(row["LocalId"])
                  for _, row in df_nodes.iterrows() if row["GlobalId"]}

    # void_rels: opening_lid → wall_lid
    # fill_rels: door_or_window_lid → opening_lid
    void_rels: dict[int, int] = {}
    fill_rels: dict[int, int] = {}

    for eid, ent in entities.items():
        a = ent["attrs"]
        t = ent["type"]
        if t == "IFCRELVOIDSELEMENT":
            wall_ref    = safe_get(a, 4)
            opening_ref = safe_get(a, 5)
            if (isinstance(wall_ref, str) and wall_ref.startswith("#") and
                    isinstance(opening_ref, str) and opening_ref.startswith("#")):
                void_rels[int(opening_ref[1:])] = int(wall_ref[1:])
        elif t == "IFCRELFILLSELEMENT":
            opening_ref  = safe_get(a, 4)
            filling_ref  = safe_get(a, 5)
            if (isinstance(opening_ref, str) and opening_ref.startswith("#") and
                    isinstance(filling_ref, str) and filling_ref.startswith("#")):
                fill_rels[int(filling_ref[1:])] = int(opening_ref[1:])

    rows = []
    ok = 0

    for product in ifc.by_type("IfcDoor") + ifc.by_type("IfcWindow"):
        gid = product.GlobalId
        lid = gid_to_lid.get(gid)
        if lid is None:
            continue

        elem_type = "door" if product.is_a() in ("IfcDoor",) else "window"

        # Rezolvăm lanțul door/window → opening → wall
        opening_lid = fill_rels.get(lid)
        host_wall_lid: int | None = None
        if opening_lid is not None:
            host_wall_lid = void_rels.get(opening_lid)
        # Fallback direct dacă fill_rels lipsă
        if host_wall_lid is None:
            host_wall_lid = void_rels.get(lid)

        if host_wall_lid is None or host_wall_lid not in wp_dict:
            continue

        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
            verts = np.array(list(shape.geometry.verts)).reshape(-1, 3)
            if len(verts) == 0:
                continue

            bbox_min = verts.min(axis=0)
            bbox_max = verts.max(axis=0)
            cx = float((bbox_min[0] + bbox_max[0]) / 2)
            cy = float((bbox_min[1] + bbox_max[1]) / 2)
            sill_z = float(bbox_min[2])

            # Proiecție centroid pe axa zidului → t_along_wall
            wp = wp_dict[host_wall_lid]
            sx, sy = wp["StartX"], wp["StartY"]
            ex, ey = wp["EndX"],   wp["EndY"]
            wdx, wdy = ex - sx, ey - sy
            wall_len_sq = wdx * wdx + wdy * wdy
            if wall_len_sq > 1e-12:
                t_raw = ((cx - sx) * wdx + (cy - sy) * wdy) / wall_len_sq
                t_val = max(0.0, min(1.0, t_raw))
            else:
                t_val = 0.5

            # Dimensiuni din IFC
            width  = 0.9  if elem_type == "door" else 1.2
            height = 2.1  if elem_type == "door" else 1.2
            if hasattr(product, "OverallWidth") and product.OverallWidth:
                width = float(product.OverallWidth)
            if hasattr(product, "OverallHeight") and product.OverallHeight:
                height = float(product.OverallHeight)

            rows.append({
                "LocalId": lid, "GlobalId": gid,
                "HostWallLocalId": host_wall_lid,
                "TAlongWall": t_val,
                "Width": width, "Height": height, "SillZ": sill_z,
                "ElemType": elem_type,
            })
            ok += 1
        except Exception:
            pass

    if not rows:
        print("  [v2-openparam] Nicio ușă/fereastră procesată.", flush=True)
        return

    BATCH = 100
    for start in range(0, len(rows), BATCH):
        for row in rows[start: start + BATCH]:
            conn.execute(
                "CREATE (:OpeningParam {"
                "LocalId:$lid, GlobalId:$gid,"
                "HostWallLocalId:$hwl,"
                "TAlongWall:$t, Width:$w, Height:$h, SillZ:$sz,"
                "ElemType:$et"
                "})",
                {"lid": int(row["LocalId"]), "gid": str(row["GlobalId"]),
                 "hwl": int(row["HostWallLocalId"]),
                 "t": row["TAlongWall"], "w": row["Width"],
                 "h": row["Height"], "sz": row["SillZ"],
                 "et": row["ElemType"]}
            )
    print(f"  [v2-openparam] OpeningParam: {ok} elemente în {_time.time()-t0:.1f}s", flush=True)


# ---------------------------------------------------------------------------
# Material v2 (cu culoare embeddată)
# ---------------------------------------------------------------------------
def _build_materials_v2(conn, df_mat: pd.DataFrame, df_elem_mat: pd.DataFrame,
                         valid_ids: set) -> None:
    """Inserează Material (simplified) + HasMaterial."""
    if df_mat.empty:
        return

    # Deduplică materialele după IFCMatId (un material fizic, nu per layer)
    seen: dict[int, int] = {}  # IFCMatId → MatId (row în rows_mat)
    rows_mat = []
    ifc_mat_to_new_id: dict[int, int] = {}

    for _, row in df_mat.iterrows():
        ifc_mat_id = int(row["IFCMatId"])
        if ifc_mat_id in seen:
            ifc_mat_to_new_id[int(row["MatId"])] = seen[ifc_mat_id]
            continue
        new_id = len(rows_mat)
        seen[ifc_mat_id] = new_id
        ifc_mat_to_new_id[int(row["MatId"])] = new_id
        rows_mat.append({
            "MatId": new_id,
            "Name": str(row["Name"] or ""),
            "Thickness": float(row["Thickness"]),
            "CR": 0.7, "CG": 0.7, "CB": 0.7, "CA": 1.0,  # default; override mai jos
        })

    for row in rows_mat:
        conn.execute(
            "CREATE (:Material {MatId:$mid, Name:$n, Thickness:$t, CR:$r, CG:$g, CB:$b, CA:$a})",
            {"mid": int(row["MatId"]), "n": row["Name"],
             "t": row["Thickness"], "r": row["CR"], "g": row["CG"],
             "b": row["CB"], "a": row["CA"]}
        )
    print(f"  [v2-mat] Material: {len(rows_mat)} rânduri", flush=True)

    # HasMaterial
    new_mat_ids = set(r["MatId"] for r in rows_mat)
    ok = 0
    seen_pairs: set[tuple] = set()
    for _, row in df_elem_mat.iterrows():
        elem_lid = int(row["LocalId"])
        if elem_lid not in valid_ids:
            continue
        old_mat_id = int(row["MatId"])
        new_mat_id = ifc_mat_to_new_id.get(old_mat_id)
        if new_mat_id is None or new_mat_id not in new_mat_ids:
            continue
        pair = (elem_lid, new_mat_id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        try:
            conn.execute(
                "MATCH (e:IfcElement {LocalId:$eid}), (m:Material {MatId:$mid}) "
                "CREATE (e)-[:HasMaterial {LayerOrder:$lo}]->(m)",
                {"eid": elem_lid, "mid": new_mat_id, "lo": int(row["LayerOrder"])}
            )
            ok += 1
        except Exception:
            pass
    print(f"  [v2-mat] HasMaterial: {ok} relații", flush=True)


# ---------------------------------------------------------------------------
# Relații typed v2
# ---------------------------------------------------------------------------
def _build_typed_rels_v2(conn, entities: dict, valid_ids: set) -> None:
    """Construiește WallAdjacent, Hosts, InStorey din entitățile parsate."""

    skip_typed = {"IFCRELCONNECTSPATHELEMENTS", "IFCRELVOIDSELEMENT",
                  "IFCRELFILLSELEMENT", "IFCRELCONTAINEDINSPATIALSTRUCTURE"}

    wall_adj = []    # (lid_a, lid_b)
    hosts    = []    # (lida, lidb)
    instorey = []   # (elem_lid, storey_lid)

    for eid, ent in entities.items():
        t = ent["type"]
        a = ent["attrs"]

        if t == "IFCRELCONNECTSPATHELEMENTS":
            rel_ref = safe_get(a, 5)
            ted_ref = safe_get(a, 6)
            if (isinstance(rel_ref, str) and rel_ref.startswith("#") and
                    isinstance(ted_ref, str) and ted_ref.startswith("#")):
                la, lb = int(rel_ref[1:]), int(ted_ref[1:])
                if la in valid_ids and lb in valid_ids and la != lb:
                    wall_adj.append((la, lb))

        elif t == "IFCRELVOIDSELEMENT":
            wall_ref    = safe_get(a, 4)
            opening_ref = safe_get(a, 5)
            if (isinstance(wall_ref, str) and wall_ref.startswith("#") and
                    isinstance(opening_ref, str) and opening_ref.startswith("#")):
                la, lb = int(wall_ref[1:]), int(opening_ref[1:])
                if la in valid_ids and lb in valid_ids:
                    hosts.append((la, lb))

        elif t == "IFCRELFILLSELEMENT":
            opening_ref = safe_get(a, 4)
            fill_ref    = safe_get(a, 5)
            if (isinstance(opening_ref, str) and opening_ref.startswith("#") and
                    isinstance(fill_ref, str) and fill_ref.startswith("#")):
                la, lb = int(opening_ref[1:]), int(fill_ref[1:])
                if la in valid_ids and lb in valid_ids:
                    hosts.append((la, lb))

        elif t == "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            struct_ref = safe_get(a, 5)
            if not (isinstance(struct_ref, str) and struct_ref.startswith("#")):
                continue
            storey_lid = int(struct_ref[1:])
            # Includ doar BuildingStorey
            if entities.get(storey_lid, {}).get("type") != "IFCBUILDINGSTOREY":
                continue
            elem_list = safe_get(a, 4)
            if not isinstance(elem_list, list):
                continue
            for ref in elem_list:
                if isinstance(ref, str) and ref.startswith("#"):
                    elem_lid = int(ref[1:])
                    if elem_lid in valid_ids:
                        instorey.append((elem_lid, storey_lid))

    # Inserare WallAdjacent
    seen_wa: set[frozenset] = set()
    wa_ok = 0
    for la, lb in wall_adj:
        key = frozenset([la, lb])
        if key in seen_wa:
            continue
        seen_wa.add(key)
        try:
            conn.execute(
                "MATCH (a:IfcElement {LocalId:$la}), (b:IfcElement {LocalId:$lb}) "
                "CREATE (a)-[:WallAdjacent]->(b)",
                {"la": la, "lb": lb}
            )
            wa_ok += 1
        except Exception:
            pass
    print(f"  [v2-rels] WallAdjacent: {wa_ok}", flush=True)

    # Inserare Hosts
    hs_ok = 0
    for la, lb in hosts:
        try:
            conn.execute(
                "MATCH (a:IfcElement {LocalId:$la}), (b:IfcElement {LocalId:$lb}) "
                "CREATE (a)-[:Hosts]->(b)",
                {"la": la, "lb": lb}
            )
            hs_ok += 1
        except Exception:
            pass
    print(f"  [v2-rels] Hosts: {hs_ok}", flush=True)

    # Inserare InStorey
    is_ok = 0
    for elem_lid, storey_lid in instorey:
        try:
            conn.execute(
                "MATCH (e:IfcElement {LocalId:$el}), (s:IfcElement {LocalId:$sl}) "
                "CREATE (e)-[:InStorey]->(s)",
                {"el": elem_lid, "sl": storey_lid}
            )
            is_ok += 1
        except Exception:
            pass
    print(f"  [v2-rels] InStorey: {is_ok}", flush=True)

    # Relation generică (fallback — fără rel-urile deja tipizate)
    generic_ok = 0
    for eid, ent in entities.items():
        t = ent["type"]
        if not t.startswith("IFCREL") or t in skip_typed:
            continue
        a = ent["attrs"]
        gid = safe_get(a, 0)
        gid = gid if isinstance(gid, str) else ""
        # Detectăm src/tgt conservator: prima ref la attr[4], a doua la attr[5]
        src_raw = safe_get(a, 4)
        tgt_raw = safe_get(a, 5)
        srcs = ([int(src_raw[1:])] if isinstance(src_raw, str) and src_raw.startswith("#")
                else [int(x[1:]) for x in src_raw if isinstance(x, str) and x.startswith("#")]
                if isinstance(src_raw, list) else [])
        tgts = ([int(tgt_raw[1:])] if isinstance(tgt_raw, str) and tgt_raw.startswith("#")
                else [int(x[1:]) for x in tgt_raw if isinstance(x, str) and x.startswith("#")]
                if isinstance(tgt_raw, list) else [])
        for src in srcs:
            for tgt in tgts:
                if src in valid_ids and tgt in valid_ids and src != tgt:
                    try:
                        conn.execute(
                            "MATCH (a:IfcElement {LocalId:$la}), (b:IfcElement {LocalId:$lb}) "
                            "CREATE (a)-[:Relation {RelId:$rid, RelType:$rt, GlobalId:$gid}]->(b)",
                            {"la": src, "lb": tgt, "rid": eid, "rt": t, "gid": gid}
                        )
                        generic_ok += 1
                    except Exception:
                        pass
    print(f"  [v2-rels] Relation (generic): {generic_ok}", flush=True)


# ---------------------------------------------------------------------------
# Main v2
# ---------------------------------------------------------------------------
def main_v2():
    try:
        import kuzu
    except ImportError:
        raise SystemExit("kuzu nu este instalat. Rulați: pip install kuzu")

    t_total = _time.time()
    print("[v2] Încărcare configurare ...", flush=True)
    categories, skip_types, rel_attr_map = load_config()
    node_types  = all_node_types(categories)
    type_to_cat = type_to_cat_map(categories)

    print("[v2] Parsare IFC ...", flush=True)
    entities = parse_ifc_file(IFC_PATH)
    nodes     = build_nodes(entities, node_types, skip_types, type_to_cat)
    node_ids  = set(nodes["LocalId"].tolist())
    _, _, df_elem_mat, _ = build_materials(entities, node_ids)

    # Normalizare pentru Kuzu STRING
    for col in ["GlobalId", "Name", "Category", "IfcClass"]:
        if col in nodes.columns:
            nodes[col] = nodes[col].fillna("")

    # ── Recreare DB (backup automat al v1 dacă există) ──────────────────────
    # KuzuDB poate fi un fișier (embedded) sau un director — tratăm ambele cazuri
    backup_dir = DB_DIR.parent / "kuzu_db_v1_backup"
    if DB_DIR.exists():
        if backup_dir.exists():
            if backup_dir.is_dir():
                shutil.rmtree(backup_dir)
            else:
                backup_dir.unlink()
        if DB_DIR.is_dir():
            shutil.copytree(DB_DIR, backup_dir)
            shutil.rmtree(DB_DIR)
        else:
            shutil.copy2(DB_DIR, backup_dir)
            DB_DIR.unlink()
        print(f"[v2] Backup v1 → {backup_dir}", flush=True)

    db   = kuzu.Database(str(DB_DIR))
    conn = kuzu.Connection(db)

    print("[v2] Creare schema v2 ...", flush=True)
    _create_v2_schema(conn)

    # IfcElement (fără StepBody etc.) — INSERT loop (COPY FROM df eșuează cu numpy types)
    nodes_v2 = nodes[["LocalId", "GlobalId", "IfcClass", "Category", "Name"]].copy()
    ok_elem = 0
    for _, row in nodes_v2.iterrows():
        conn.execute(
            "CREATE (:IfcElement {LocalId:$lid, GlobalId:$gid, IfcClass:$ic, "
            "Category:$cat, Name:$nm})",
            {"lid": int(row["LocalId"]),
             "gid": str(row.get("GlobalId", "") or ""),
             "ic":  str(row.get("IfcClass", "") or ""),
             "cat": str(row.get("Category", "") or ""),
             "nm":  str(row.get("Name", "") or "")}
        )
        ok_elem += 1
    print(f"  IfcElement: {ok_elem}", flush=True)

    valid_ids = set(int(x) for x in nodes_v2["LocalId"].tolist())

    # StepLine eliminat din KuzuDB v2 — stocat separat în out/step_all.parquet
    # (ifc_to_parquet_full.py generează fișierul; backend-ul îl citește direct)

    # ElementGeom (geometry + color + bbox)
    print("[v2] Calculare ElementGeom ...", flush=True)
    _build_elem_geom_v2(conn, nodes_v2, IFC_PATH)

    # WallParam
    print("[v2] Calculare WallParam ...", flush=True)
    wp_dict = _build_wall_params_v2(conn, nodes_v2, entities, IFC_PATH)

    # OpeningParam
    print("[v2] Calculare OpeningParam ...", flush=True)
    _build_opening_params_v2(conn, nodes_v2, entities, IFC_PATH, wp_dict)

    # Material v2
    print("[v2] Inserare Material ...", flush=True)
    df_mat_full, _, df_elem_mat_full, _ = build_materials(entities, node_ids)
    _build_materials_v2(conn, df_mat_full, df_elem_mat_full, valid_ids)

    # Relații typed + generic
    print("[v2] Construire relații ...", flush=True)
    _build_typed_rels_v2(conn, entities, valid_ids)

    elapsed = _time.time() - t_total
    print(f"\n[v2] Done. KuzuDB v2 at: {DB_DIR}  ({elapsed:.1f}s total)", flush=True)
    print(f"[v2] Backup v1 la: {backup_dir}", flush=True)
    step_pq = _HERE / "out" / "step_all.parquet"
    if step_pq.exists():
        print(f"[v2] StepLine parquet: {step_pq} ({step_pq.stat().st_size//1024//1024}MB)", flush=True)
    else:
        print(f"[v2] ATENȚIE: {step_pq} lipsește — rulați ifc_to_parquet_full.py", flush=True)


if __name__ == "__main__":
    main_v2()

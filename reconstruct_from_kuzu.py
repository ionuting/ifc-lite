"""Reconstruiește IFC filtrat interogând KuzuDB (fără fișiere externe)
====================================================================
Folosește exclusiv KuzuDB:
  IfcElement  — noduri (1086) cu metadate + StepBody
  Relation    — relații dintre noduri
  StepLine    — toate entitățile STEP pentru geometrie/dep.
  Material    — materiale extrase
  ColourRGB   — culori + transparență

Algoritm:
  1. Interogare KuzuDB: seeds (IfcElement) filtrate după Category
  2. Interogare KuzuDB: relații directe (Relation) care leagă seedurile
  3. Încărcă StepLine din KuzuDB ca dict {LocalId: StepBody}
  4. BFS geometrie din seeds (se oprește la IFCREL)
  5. Colectează IFCMatId și SurfaceStyleId pentru seeds → BFS material/culoare
  6. Scrie fișier IFC text valid

Utilizare:
  python schema/reconstruct_from_kuzu.py [categorie1 categorie2 ...]

Exemple:
  python schema/reconstruct_from_kuzu.py walls slabs doors windows openings
  python schema/reconstruct_from_kuzu.py walls
  python schema/reconstruct_from_kuzu.py          # → categorii implicite

Dependințe: kuzu pandas pyarrow
"""
from __future__ import annotations
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ifc_config import load_config

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_HERE   = Path(__file__).parent.parent
DB_DIR  = _HERE / "kuzu_db"

DEFAULT_CATEGORIES = ["walls", "slabs", "doors", "windows", "openings"]

# categoriile valide sunt încărcate din parquet la runtime (vezi main)

IFC_HEADER = (
    "ISO-10303-21;\n"
    "HEADER;\n"
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\n"
    "FILE_NAME('','',(''),(''),'','','');\n"
    "FILE_SCHEMA(('IFC4'));\n"
    "ENDSEC;\n"
    "DATA;\n"
)
IFC_FOOTER = "ENDSEC;\nEND-ISO-10303-21;\n"

_REF_RE = re.compile(r"#(\d+)")

# ---------------------------------------------------------------------------
# BFS geometrie — se oprește la IFCREL pentru a nu trage alte elemente
# ---------------------------------------------------------------------------
def collect_geom_deps(seed_ids: set[int], step: dict[int, str]) -> set[int]:
    visited: set[int] = set()
    queue = list(seed_ids)
    while queue:
        eid = queue.pop()
        if eid in visited or eid not in step:
            continue
        visited.add(eid)
        if step[eid].startswith("IFCREL"):
            continue  # include dar nu traversa relații
        for ref in _REF_RE.findall(step[eid]):
            rid = int(ref)
            if rid not in visited:
                queue.append(rid)
    return visited

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    try:
        import kuzu
    except ImportError:
        raise SystemExit("kuzu nu este instalat.")

    categories, _skip, _rel = load_config()
    valid_categories = set(categories.keys())

    categories_arg = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_CATEGORIES
    unknown = [c for c in categories_arg if c not in valid_categories]
    if unknown:
        raise SystemExit(
            f"Categorii necunoscute: {unknown}\n"
            f"Categorii disponibile: {sorted(valid_categories)}"
        )
    categories_req = categories_arg
    t0 = time.time()

    # Conexiune KuzuDB (read-only)
    if not Path(str(DB_DIR)).exists():
        raise SystemExit(
            f"KuzuDB not found at: {DB_DIR}\n"
            "Rulați mai întâi: python schema/ifc_to_kuzu.py"
        )
    db   = kuzu.Database(str(DB_DIR), read_only=True)
    conn = kuzu.Connection(db)

    # 1. Seeds din KuzuDB: noduri filtrate după Category
    cat_list = ", ".join(f"'{c}'" for c in categories_req)
    query_nodes = f"""
        MATCH (n:IfcElement)
        WHERE n.Category IN [{cat_list}]
        RETURN n.LocalId AS LocalId, n.Name AS Name, n.Category AS Category
    """
    result = conn.execute(query_nodes)
    seed_ids: set[int] = set()
    while result.has_next():
        row = result.get_next()
        seed_ids.add(int(row[0]))
    print(f"Seeds din KuzuDB ({', '.join(categories_req)}): {len(seed_ids)}", flush=True)

    if not seed_ids:
        raise SystemExit("Nicio sămânță în KuzuDB pentru categoriile cerute.")

    # 2. Relații directe din KuzuDB: Relation care leagă cel puțin un seed
    #    Interogăm ambele direcții dintr-o dată
    query_rels = f"""
        MATCH (a:IfcElement)-[r:Relation]-(b:IfcElement)
        WHERE a.Category IN [{cat_list}]
        RETURN DISTINCT r.RelId AS RelId
    """
    result = conn.execute(query_rels)
    rel_ids: set[int] = set()
    while result.has_next():
        row = result.get_next()
        if row[0] is not None:
            rel_ids.add(int(row[0]))
    print(f"Relații directe din KuzuDB: {len(rel_ids)}", flush=True)

    # 3. Încarcă StepLine din KuzuDB ca dict {LocalId: StepBody}
    print("Încărcare StepLine din KuzuDB ...", flush=True)
    result = conn.execute("MATCH (s:StepLine) RETURN s.LocalId, s.StepBody")
    step: dict[int, str] = {}
    while result.has_next():
        row = result.get_next()
        step[int(row[0])] = row[1]
    print(f"  {len(step)} entități în StepLine", flush=True)

    # Reverse maps construite într-un singur pas peste StepLine:
    # mat_to_def_rep : IFCMATERIAL id → IFCMATERIALDEFINITIONREPRESENTATION id
    #   (IFCMATERIALDEFINITIONREPRESENTATION referă materialul, nu invers)
    # geom_to_style  : geometry item id → [IFCSTYLEDITEM / IFCINDEXEDCOLOURMAP ids]
    #   (aceste entități referă geometria, nu invers — BFS normal nu le descoperă)
    mat_to_def_rep: dict[int, int] = {}
    geom_to_style: dict[int, list[int]] = {}
    for eid, body in step.items():
        if body.startswith("IFCMATERIALDEFINITIONREPRESENTATION"):
            # IFCMATERIALDEFINITIONREPRESENTATION($,$,(#reps),#mat) — ultima ref e materialul
            refs = _REF_RE.findall(body)
            if refs:
                mat_to_def_rep[int(refs[-1])] = eid
        elif body.startswith("IFCSTYLEDITEM(#"):
            # IFCSTYLEDITEM(#geom_item,(#style),$) — prima ref e item-ul de geometrie
            refs = _REF_RE.findall(body)
            if refs:
                geom_to_style.setdefault(int(refs[0]), []).append(eid)
        elif body.startswith("IFCINDEXEDCOLOURMAP(#"):
            # IFCINDEXEDCOLOURMAP(#tessellation, opacity, #colours, ...) — prima ref e tessellation
            refs = _REF_RE.findall(body)
            if refs:
                geom_to_style.setdefault(int(refs[0]), []).append(eid)
    print(f"  Reverse maps: {len(mat_to_def_rep)} def_reps, {len(geom_to_style)} geom→style", flush=True)

    # 4. BFS geometrie/placement din seeds
    print("BFS geometrie ...", flush=True)
    geom_ids = collect_geom_deps(seed_ids, step)
    print(f"  după BFS: {len(geom_ids)} entități", flush=True)

    # 5. Material & culoare: extrage IFCMatId + SurfaceStyleId via HasMaterial/HasColour
    #    și face BFS pe StepLine pentru lanțul complet de material
    seed_id_list = ", ".join(str(i) for i in seed_ids)

    mat_step_ids: set[int] = set()

    assoc_rel_ids: set[int] = set()  # LocalId-uri IFCRELASSOCIATESMATERIAL
    mat_def_rep_ids: set[int] = set()  # LocalId-uri IFCMATERIALDEFINITIONREPRESENTATION

    # HasMaterial → IFCMatId + AssocRelStepId + MatDefRepId
    try:
        result = conn.execute(
            f"MATCH (e:IfcElement)-[h:HasMaterial]->(m:Material) "
            f"WHERE e.LocalId IN [{seed_id_list}] "
            f"RETURN DISTINCT m.IFCMatId, h.AssocRelStepId, m.MatDefRepId"
        )
        while result.has_next():
            row = result.get_next()
            if row[0] is not None:
                mat_step_ids.add(int(row[0]))
            if row[1] is not None:
                assoc_rel_ids.add(int(row[1]))
            if row[2] is not None and int(row[2]) >= 0:
                mat_def_rep_ids.add(int(row[2]))
    except Exception:
        pass  # tabelele pot lipsi dacă DB a fost generat cu o versiune veche

    # HasColour → SurfaceStyleId
    try:
        result = conn.execute(
            f"MATCH (e:IfcElement)-[h:HasColour]->(c:ColourRGB) "
            f"WHERE e.LocalId IN [{seed_id_list}] "
            f"RETURN DISTINCT c.SurfaceStyleId"
        )
        while result.has_next():
            row = result.get_next()
            if row[0] is not None:
                mat_step_ids.add(int(row[0]))
    except Exception:
        pass

    # BFS pe lanțul de material/culoare din StepLine
    mat_step_ids |= mat_def_rep_ids  # din KuzuDB dacă DB-ul e nou

    # Extrage referințele din IFCRELASSOCIATESMATERIAL body-uri
    for rel_id in assoc_rel_ids:
        if rel_id in step:
            for ref in _REF_RE.findall(step[rel_id]):
                mat_step_ids.add(int(ref))

    # Adaugă IFCMATERIALDEFINITIONREPRESENTATION via reverse map (robust, fără dep. de versiunea DB)
    # IFCMATERIAL nu are ref-uri — BFS se oprește la el; def_rep trebuie adaugat explicit
    for m_id in list(mat_step_ids):
        if m_id in mat_to_def_rep:
            mat_step_ids.add(mat_to_def_rep[m_id])

    if mat_step_ids:
        print(f"  Material/colour seeds: {len(mat_step_ids)}", flush=True)
        mat_geom_ids = collect_geom_deps(mat_step_ids, step)
        geom_ids |= mat_geom_ids
        print(f"  după BFS material: {len(geom_ids)} entități", flush=True)

    # Adaugă IFCSTYLEDITEM / IFCINDEXEDCOLOURMAP via reverse map:
    # aceste entități referă geometria (nu invers), deci BFS normal nu le descoperă
    style_extra: set[int] = set()
    for gid in geom_ids:
        for sid in geom_to_style.get(gid, []):
            style_extra.add(sid)
    if style_extra:
        geom_ids |= collect_geom_deps(style_extra, step)
        print(f"  Stiluri per geometrie adăugate: {len(style_extra)}", flush=True)

    # 6. Adaugă relațiile directe + IFCRELASSOCIATESMATERIAL
    all_ids = geom_ids | rel_ids | assoc_rel_ids
    if assoc_rel_ids:
        print(f"  IFCRELASSOCIATESMATERIAL incluse: {len(assoc_rel_ids)}", flush=True)
    print(f"  STEP lines totale: {len(all_ids)}", flush=True)

    # 7. Scrie IFC
    cat_label = "_".join(categories_req)
    out_ifc = _HERE / f"reconstructed_kuzu_{cat_label}.ifc"
    lines = [f"#{eid}={step[eid]};" for eid in sorted(all_ids) if eid in step]
    with open(out_ifc, "w", encoding="utf-8") as fh:
        fh.write(IFC_HEADER)
        fh.write("\n".join(lines))
        fh.write("\n")
        fh.write(IFC_FOOTER)
    print(f"Scris {out_ifc}  ({len(lines)} entități, {time.time()-t0:.1f}s)", flush=True)

if __name__ == "__main__":
    main()

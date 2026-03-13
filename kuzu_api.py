from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import kuzu
import json
from pathlib import Path

app = FastAPI()

DB_PATH = Path(__file__).parent.parent / "kuzu_db"

def get_conn():
    db = kuzu.Database(str(DB_PATH))
    return kuzu.Connection(db)

class NodeModel(BaseModel):
    id: int
    type: str
    name: str
    x: float
    y: float
    z: float
    properties: dict

class EdgeModel(BaseModel):
    id: int
    source: int
    target: int
    sourceSlot: Optional[int] = None
    targetSlot: Optional[int] = None
    properties: Optional[dict] = {}

@app.get("/nodes", response_model=List[NodeModel])
def get_nodes():
    conn = get_conn()
    result = conn.execute("MATCH (n:IfcElement) RETURN n.LocalId, n.IfcClass, n.Name, n.PlacementRef, n.RepRef, n.StepBody")
    nodes = []
    while result.has_next():
        row = result.get_next()
        nodes.append(NodeModel(
            id=row[0],
            type=row[1],
            name=row[2],
            x=0, y=0, z=0,  # Placeholder, update with actual fields
            properties={
                "PlacementRef": row[3],
                "RepRef": row[4],
                "StepBody": row[5]
            }
        ))
    return nodes

@app.post("/nodes")
def add_node(node: NodeModel):
    conn = get_conn()
    props = json.dumps(node.properties)
    conn.execute(
        "CREATE (n:IfcElement {LocalId: $id, IfcClass: $type, Name: $name, StepBody: $stepbody})",
        {"id": node.id, "type": node.type, "name": node.name, "stepbody": props}
    )
    return {"status": "ok"}

@app.get("/edges", response_model=List[EdgeModel])
def get_edges():
    conn = get_conn()
    result = conn.execute("MATCH ()-[r:Relation]->() RETURN r.RelId, r.GlobalId, r.RelType")
    edges = []
    while result.has_next():
        row = result.get_next()
        edges.append(EdgeModel(
            id=row[0],
            source=0,  # Placeholder
            target=0,  # Placeholder
            properties={"GlobalId": row[1], "RelType": row[2]}
        ))
    return edges

@app.post("/edges")
def add_edge(edge: EdgeModel):
    conn = get_conn()
    props = json.dumps(edge.properties)
    conn.execute(
        "CREATE (a:IfcElement)-[r:Relation {RelId: $id, RelType: $type, GlobalId: $gid}]->(b:IfcElement)",
        {"id": edge.id, "type": edge.properties.get("RelType", ""), "gid": edge.properties.get("GlobalId", "")}
    )
    return {"status": "ok"}

@app.put("/nodes/{node_id}")
def update_node(node_id: int, node: NodeModel):
    conn = get_conn()
    props = json.dumps(node.properties)
    conn.execute(
        "MATCH (n:IfcElement) WHERE n.LocalId = $id SET n.Name = $name, n.StepBody = $stepbody",
        {"id": node_id, "name": node.name, "stepbody": props}
    )
    return {"status": "ok"}

@app.delete("/nodes/{node_id}")
def delete_node(node_id: int):
    conn = get_conn()
    conn.execute("MATCH (n:IfcElement) WHERE n.LocalId = $id DELETE n", {"id": node_id})
    return {"status": "ok"}

@app.delete("/edges/{edge_id}")
def delete_edge(edge_id: int):
    conn = get_conn()
    conn.execute("MATCH ()-[r:Relation]->() WHERE r.RelId = $id DELETE r", {"id": edge_id})
    return {"status": "ok"}

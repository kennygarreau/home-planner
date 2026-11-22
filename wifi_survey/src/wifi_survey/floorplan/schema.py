"""floorplan.json (schema_version 1) as produced by the home planner's
GET /api/floorplans/export/wifi. Units: metres; x right, y down."""

from __future__ import annotations

from pydantic import BaseModel, Field

Point = tuple[float, float]


class Room(BaseModel):
    id: str
    name: str
    polygon: list[Point]
    area_m2: float = 0.0
    priority: str = "normal"
    use: list[str] = Field(default_factory=list[str])
    ap_allowed: bool = True


class Wall(BaseModel):
    id: str
    a: Point
    b: Point
    material: str = "drywall"
    thickness_m: float = 0.12
    exterior: bool = False


class Opening(BaseModel):
    id: str = ""
    wall_id: str
    type: str
    offset_m: float  # wall.a → near edge
    width_m: float
    height_m: float = 0.0
    material: str | None = None


class ExistingAp(BaseModel):
    id: str
    label: str
    model: str = ""
    pos: Point
    mount: str = "desk"


class Site(BaseModel):
    id: str
    label: str = ""
    pos: Point
    mount: str = "ceiling"
    cable_feasible: bool = True


class Floor(BaseModel):
    id: str
    name: str
    level: int = 0
    elevation_m: float = 0.0
    ceiling_height_m: float = 2.5
    slab_material: str | None = None  # attenuation to the floor ABOVE
    ap_placement: str = "anywhere"
    rooms: list[Room] = Field(default_factory=list[Room])
    walls: list[Wall] = Field(default_factory=list[Wall])
    openings: list[Opening] = Field(default_factory=list[Opening])
    existing_aps: list[ExistingAp] = Field(default_factory=list[ExistingAp])
    candidate_ap_sites: list[Site] = Field(default_factory=list[Site])


class FloorPlan(BaseModel):
    schema_version: int = 1
    units: str = "m"
    floors: list[Floor]

    def floor(self, floor_id: str) -> Floor:
        for f in self.floors:
            if f.id == floor_id:
                return f
        raise KeyError(floor_id)

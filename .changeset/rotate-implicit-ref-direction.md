---
"@ifc-lite/create": patch
"@ifc-lite/viewer": patch
---

Elements whose placement leaves `RefDirection` implicit (`IFCAXIS2PLACEMENT3D(#p,$,$)`, as many exporters write it) can now be rotated instead of being refused. `rotateProductYaw` writes the directions out first, in the same atomic edit: the `RefDirection` is the renderer's fill from the Axis (`firstProjAxis`, so an explicit tilted Axis is respected), and `Axis` is written as +Z when it was implicit too. One undo restores the original record. `resolveRotationState` reports that fill instead of a fixed +X, and the viewer's rotate and the element transform command no longer refuse these placements.

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useViewerStore, resolveEntityRef } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { toast } from '@/components/ui/toast';
import { IfcCreator, type IfcElementClass, type RawBrepParams } from '@ifc-lite/create';

interface EditorPanelProps {
  onClose: () => void;
}

interface RawElementEntry {
  id: string;
  params: RawBrepParams;
}

interface EditorSession {
  projectName: string;
  siteName: string;
  buildingName: string;
  storeyName: string;
  storeyElevation: number;
  walls: Array<{
    Start: [number, number, number];
    End: [number, number, number];
    Thickness: number;
    Height: number;
    Name?: string;
  }>;
  columns: Array<{
    Position: [number, number, number];
    Width: number;
    Depth: number;
    Height: number;
    Name?: string;
  }>;
  raws: RawElementEntry[];
  rawClassification: Record<string, { ifcClass: IfcElementClass; predefinedType?: string }>;
}

const IFC_CLASS_OPTIONS: IfcElementClass[] = [
  'IfcBuildingElementProxy',
  'IfcWall',
  'IfcColumn',
  'IfcBeam',
  'IfcSlab',
  'IfcRoof',
  'IfcStair',
];

export function EditorPanel({ onClose }: EditorPanelProps) {
  const { loadFile } = useIfc();
  const models = useViewerStore((s) => s.models);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);

  const newProjectDialogOpen = useViewerStore((s) => s.editorNewProjectDialogOpen);
  const setNewProjectDialogOpen = useViewerStore((s) => s.setEditorNewProjectDialogOpen);

  const [isApplying, setIsApplying] = useState(false);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [rawByExpressId, setRawByExpressId] = useState<Map<number, string>>(new Map());
  const [projectName, setProjectName] = useState('Untitled Project');
  const [siteName, setSiteName] = useState('Site');
  const [buildingName, setBuildingName] = useState('Building');
  const [storeyName, setStoreyName] = useState('Ground Floor');
  const [storeyElevation, setStoreyElevation] = useState(0);

  const [wallStartX, setWallStartX] = useState(0);
  const [wallStartY, setWallStartY] = useState(0);
  const [wallLength, setWallLength] = useState(5);
  const [wallThickness, setWallThickness] = useState(0.2);
  const [wallHeight, setWallHeight] = useState(3);

  const [columnX, setColumnX] = useState(0);
  const [columnY, setColumnY] = useState(0);
  const [columnWidth, setColumnWidth] = useState(0.3);
  const [columnDepth, setColumnDepth] = useState(0.3);
  const [columnHeight, setColumnHeight] = useState(3);

  const [rawX, setRawX] = useState(0);
  const [rawY, setRawY] = useState(0);
  const [rawZ, setRawZ] = useState(0);
  const [rawWidth, setRawWidth] = useState(1);
  const [rawDepth, setRawDepth] = useState(1);
  const [rawHeight, setRawHeight] = useState(1);
  const [rawIfcClass, setRawIfcClass] = useState<IfcElementClass>('IfcBuildingElementProxy');

  const [classifyIfcClass, setClassifyIfcClass] = useState<IfcElementClass>('IfcWall');
  const [classifyPredefinedType, setClassifyPredefinedType] = useState('.NOTDEFINED.');

  const selectedLocalExpressId = useMemo(() => {
    if (selectedEntityId === null) return null;
    return resolveEntityRef(selectedEntityId).expressId;
  }, [selectedEntityId]);

  const selectedTypeName = useMemo(() => {
    if (!ifcDataStore || selectedLocalExpressId === null) return null;
    try {
      return ifcDataStore.entities.getTypeName(selectedLocalExpressId);
    } catch {
      return null;
    }
  }, [ifcDataStore, selectedLocalExpressId]);

  const selectedRawId = selectedLocalExpressId !== null ? rawByExpressId.get(selectedLocalExpressId) ?? null : null;

  const applySession = async (nextSession: EditorSession): Promise<void> => {
    setIsApplying(true);
    try {
      const creator = new IfcCreator({
        Name: nextSession.projectName,
        SiteName: nextSession.siteName,
        BuildingName: nextSession.buildingName,
        Schema: 'IFC4',
      });
      const storeyId = creator.addIfcBuildingStorey({
        Name: nextSession.storeyName,
        Elevation: nextSession.storeyElevation,
      });

      for (const wall of nextSession.walls) {
        creator.addIfcWall(storeyId, wall);
      }
      for (const column of nextSession.columns) {
        creator.addIfcColumn(storeyId, column);
      }

      const rawExpressById = new Map<string, number>();
      const expressToRaw = new Map<number, string>();
      for (const raw of nextSession.raws) {
        const expressId = creator.addIfcRawBrep(storeyId, raw.params);
        rawExpressById.set(raw.id, expressId);
        expressToRaw.set(expressId, raw.id);
      }

      for (const [rawId, classification] of Object.entries(nextSession.rawClassification)) {
        const expressId = rawExpressById.get(rawId);
        if (!expressId) continue;
        creator.classifyRawElement(expressId, classification.ifcClass, classification.predefinedType);
      }

      const result = creator.toIfc();
      const safeName = nextSession.projectName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'editor';
      const file = new File([result.content], `${safeName}.ifc`, { type: 'application/x-step' });
      await loadFile(file);

      // loadFile calls resetViewerState internally, which resets editorPanelVisible.
      // Re-open the editor and ensure the right panel is expanded.
      const store = useViewerStore.getState();
      store.setEditorPanelVisible(true);
      store.setRightPanelCollapsed(false);

      setSession(nextSession);
      setRawByExpressId(expressToRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Editor update failed: ${message}`);
      throw err;
    } finally {
      setIsApplying(false);
    }
  };

  const createBlankProject = async () => {
    const next: EditorSession = {
      projectName,
      siteName,
      buildingName,
      storeyName,
      storeyElevation,
      walls: [],
      columns: [],
      raws: [],
      rawClassification: {},
    };
    setNewProjectDialogOpen(false);
    await applySession(next);
    toast.success(`Project "${projectName}" created`);
  };

  const addWall = async () => {
    if (!session) {
      toast.error('Create a blank project first');
      return;
    }
    const next: EditorSession = {
      ...session,
      walls: [
        ...session.walls,
        {
          Name: `Wall ${session.walls.length + 1}`,
          Start: [wallStartX, wallStartY, 0],
          End: [wallStartX + wallLength, wallStartY, 0],
          Thickness: wallThickness,
          Height: wallHeight,
        },
      ],
    };
    await applySession(next);
    toast.success('IfcWall added');
  };

  const addColumn = async () => {
    if (!session) {
      toast.error('Create a blank project first');
      return;
    }
    const next: EditorSession = {
      ...session,
      columns: [
        ...session.columns,
        {
          Name: `Column ${session.columns.length + 1}`,
          Position: [columnX, columnY, 0],
          Width: columnWidth,
          Depth: columnDepth,
          Height: columnHeight,
        },
      ],
    };
    await applySession(next);
    toast.success('IfcColumn added');
  };

  const addRawBox = async () => {
    if (!session) {
      toast.error('Create a blank project first');
      return;
    }

    const rawId = crypto.randomUUID();
    const vertices: Array<[number, number, number]> = [
      [0, 0, 0],
      [rawWidth, 0, 0],
      [rawWidth, rawDepth, 0],
      [0, rawDepth, 0],
      [0, 0, rawHeight],
      [rawWidth, 0, rawHeight],
      [rawWidth, rawDepth, rawHeight],
      [0, rawDepth, rawHeight],
    ];

    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];

    const next: EditorSession = {
      ...session,
      raws: [
        ...session.raws,
        {
          id: rawId,
          params: {
            Name: `Raw ${session.raws.length + 1}`,
            Position: [rawX, rawY, rawZ],
            Vertices: vertices,
            Faces: faces,
            IfcClass: rawIfcClass,
            PredefinedType: '.NOTDEFINED.',
          },
        },
      ],
    };
    await applySession(next);
    toast.success('Raw BREP element added');
  };

  const classifySelectedRaw = async () => {
    if (!session || !selectedRawId || selectedLocalExpressId === null) {
      toast.error('Select a raw editor element first');
      return;
    }

    const next: EditorSession = {
      ...session,
      rawClassification: {
        ...session.rawClassification,
        [selectedRawId]: {
          ifcClass: classifyIfcClass,
          predefinedType: classifyPredefinedType,
        },
      },
    };
    await applySession(next);
    toast.success(`Element #${selectedLocalExpressId} classified as ${classifyIfcClass}`);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Semantic Editor</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {models.size > 1 && (
        <div className="text-xs text-muted-foreground">
          Editor MVP runs in single-model mode. Creating a blank project will replace current models.
        </div>
      )}

      <div className="space-y-2">
        {session ? (
          <div className="rounded-md border p-3 space-y-0.5 text-xs">
            <div className="font-medium text-sm mb-1">{session.projectName}</div>
            <div className="text-muted-foreground">Site: {session.siteName}</div>
            <div className="text-muted-foreground">Building: {session.buildingName}</div>
            <div className="text-muted-foreground">Storey: {session.storeyName} ({session.storeyElevation} m)</div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No active project. Create one to start adding elements.
          </p>
        )}
        <Button
          onClick={() => setNewProjectDialogOpen(true)}
          disabled={isApplying}
          variant={session ? 'outline' : 'default'}
          className="w-full"
        >
          {session ? 'New Project...' : 'Create New Project...'}
        </Button>
      </div>

      <Dialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New IFC Project</DialogTitle>
            <DialogDescription>
              Set the minimal IFC spatial structure: project, site, building and storey.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="np-project">Project Name</Label>
              <Input
                id="np-project"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Untitled Project"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-site">Site Name</Label>
              <Input
                id="np-site"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Site"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-building">Building Name</Label>
              <Input
                id="np-building"
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                placeholder="Building"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-storey">Storey Name</Label>
              <Input
                id="np-storey"
                value={storeyName}
                onChange={(e) => setStoreyName(e.target.value)}
                placeholder="Ground Floor"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-elevation">Storey Elevation (m)</Label>
              <Input
                id="np-elevation"
                type="number"
                value={storeyElevation}
                onChange={(e) => setStoreyElevation(Number(e.target.value))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProjectDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createBlankProject} disabled={isApplying || !projectName.trim()}>
              {isApplying ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Add IfcWall</h3>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" value={wallStartX} onChange={(e) => setWallStartX(Number(e.target.value))} placeholder="Start X" />
          <Input type="number" value={wallStartY} onChange={(e) => setWallStartY(Number(e.target.value))} placeholder="Start Y" />
          <Input type="number" value={wallLength} onChange={(e) => setWallLength(Number(e.target.value))} placeholder="Length" />
          <Input type="number" value={wallThickness} onChange={(e) => setWallThickness(Number(e.target.value))} placeholder="Thickness" />
          <Input type="number" value={wallHeight} onChange={(e) => setWallHeight(Number(e.target.value))} placeholder="Height" />
        </div>
        <Button onClick={addWall} disabled={isApplying || !session} className="w-full">Add Wall</Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Add IfcColumn</h3>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" value={columnX} onChange={(e) => setColumnX(Number(e.target.value))} placeholder="X" />
          <Input type="number" value={columnY} onChange={(e) => setColumnY(Number(e.target.value))} placeholder="Y" />
          <Input type="number" value={columnWidth} onChange={(e) => setColumnWidth(Number(e.target.value))} placeholder="Width" />
          <Input type="number" value={columnDepth} onChange={(e) => setColumnDepth(Number(e.target.value))} placeholder="Depth" />
          <Input type="number" value={columnHeight} onChange={(e) => setColumnHeight(Number(e.target.value))} placeholder="Height" />
        </div>
        <Button onClick={addColumn} disabled={isApplying || !session} className="w-full">Add Column</Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Add Raw Geometry</h3>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" value={rawX} onChange={(e) => setRawX(Number(e.target.value))} placeholder="X" />
          <Input type="number" value={rawY} onChange={(e) => setRawY(Number(e.target.value))} placeholder="Y" />
          <Input type="number" value={rawZ} onChange={(e) => setRawZ(Number(e.target.value))} placeholder="Z" />
          <Input type="number" value={rawWidth} onChange={(e) => setRawWidth(Number(e.target.value))} placeholder="Width" />
          <Input type="number" value={rawDepth} onChange={(e) => setRawDepth(Number(e.target.value))} placeholder="Depth" />
          <Input type="number" value={rawHeight} onChange={(e) => setRawHeight(Number(e.target.value))} placeholder="Height" />
        </div>
        <Label>Initial IFC Class</Label>
        <Select value={rawIfcClass} onValueChange={(v) => setRawIfcClass(v as IfcElementClass)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IFC_CLASS_OPTIONS.map((ifcClass) => (
              <SelectItem key={ifcClass} value={ifcClass}>{ifcClass}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={addRawBox} disabled={isApplying || !session} className="w-full">Add Raw Box</Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Classify Selected Raw Element</h3>
        <div className="text-xs text-muted-foreground">
          Selected: {selectedLocalExpressId ?? 'none'} {selectedTypeName ? `(${selectedTypeName})` : ''}
        </div>
        <Select value={classifyIfcClass} onValueChange={(v) => setClassifyIfcClass(v as IfcElementClass)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IFC_CLASS_OPTIONS.filter((ifcClass) => ifcClass !== 'IfcBuildingElementProxy').map((ifcClass) => (
              <SelectItem key={ifcClass} value={ifcClass}>{ifcClass}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label>Predefined Type Token</Label>
        <Input value={classifyPredefinedType} onChange={(e) => setClassifyPredefinedType(e.target.value)} placeholder=".STANDARD." />
        <Button onClick={classifySelectedRaw} disabled={isApplying || !session || !selectedRawId} className="w-full">
          Classify Selected
        </Button>
      </div>
    </div>
  );
}

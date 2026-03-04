/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IfcBridgeConnector — UI for the live IFC server bridge
 *
 * Connects ifc-lite to an external HTTP server that provides IFC content
 * (e.g. a C# Nodify + xBIM node-graph modeler).
 *
 * Required C# server contract:
 *   GET /api/ifc  → 200 text/plain <IFC STEP content>
 *
 * Minimal ASP.NET Core:
 *   var builder = WebApplication.CreateBuilder(args);
 *   builder.Services.AddCors(o => o.AddDefaultPolicy(
 *     p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));
 *   var app = builder.Build();
 *   app.UseCors();
 *   app.MapGet("/api/ifc", () => Results.Text(IfcGenerator.GetCurrentIfc(), "text/plain"));
 *   app.Run("http://localhost:5010");
 */

import { useState } from 'react';
import { Wifi, WifiOff, Loader2, Info, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useViewerStore } from '@/store';
import { useIfcBridge } from '@/hooks/useIfcBridge';
import { cn } from '@/lib/utils';

interface IfcBridgeConnectorProps {
  /** Render a custom trigger; defaults to a toolbar icon button */
  trigger?: React.ReactNode;
}

const CSHARP_SNIPPET = `// ASP.NET Core minimal API — ifc-lite bridge server
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(o =>
    o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();

// Replace this with your xBIM / Nodify IFC generator
string GetCurrentIfc() => System.IO.File.ReadAllText("current-model.ifc");

app.MapGet("/api/ifc", () => Results.Text(GetCurrentIfc(), "text/plain"));

app.Run("http://localhost:5010");`;

export function IfcBridgeConnector({ trigger }: IfcBridgeConnectorProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localUrl, setLocalUrl] = useState('');

  const bridgeUrl = useViewerStore((s) => s.bridgeUrl);
  const setBridgeUrl = useViewerStore((s) => s.setBridgeUrl);
  const bridgeConnected = useViewerStore((s) => s.bridgeConnected);
  const bridgeError = useViewerStore((s) => s.bridgeError);
  const bridgeLastLoaded = useViewerStore((s) => s.bridgeLastLoaded);

  const { toggleBridge } = useIfcBridge();

  const handleOpen = () => {
    setLocalUrl(bridgeUrl);
    setOpen(true);
  };

  const handleConnect = () => {
    const trimmed = localUrl.trim();
    if (trimmed) setBridgeUrl(trimmed);
    if (!bridgeConnected) toggleBridge();
    setOpen(false);
  };

  const handleDisconnect = () => {
    if (bridgeConnected) toggleBridge();
    setOpen(false);
  };

  const copySnippet = async () => {
    await navigator.clipboard.writeText(CSHARP_SNIPPET).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lastLoadedDisplay = bridgeLastLoaded
    ? new Date(bridgeLastLoaded).toLocaleTimeString()
    : null;

  const StatusIcon = bridgeConnected
    ? bridgeError
      ? WifiOff
      : Wifi
    : WifiOff;

  return (
    <>
      {/* Trigger */}
      <div onClick={handleOpen}>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'gap-1.5 font-mono text-xs',
              bridgeConnected && !bridgeError && 'text-green-500 dark:text-green-400',
              bridgeConnected && bridgeError && 'text-red-500 dark:text-red-400',
            )}
            title={
              bridgeConnected
                ? bridgeError ?? `Connected to ${bridgeUrl}`
                : 'Connect to live IFC server'
            }
          >
            <StatusIcon className="h-3.5 w-3.5" />
            {bridgeConnected ? (bridgeError ? 'Error' : 'Live') : 'Bridge'}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              Live IFC Server Bridge
            </DialogTitle>
            <DialogDescription>
              Connect ifc-lite to an external IFC producer — e.g. a C# Nodify node-graph
              app using xBIM — via a local HTTP server. The model auto-reloads whenever
              the server returns new content.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Status badge */}
            {bridgeConnected && (
              <div
                className={cn(
                  'rounded-md border px-3 py-2 text-xs font-mono',
                  bridgeError
                    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
                    : 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300',
                )}
              >
                {bridgeError ? (
                  <span>⚠ {bridgeError}</span>
                ) : (
                  <span>
                    ✓ Connected — polling every 2 s
                    {lastLoadedDisplay && <> · last load: <strong>{lastLoadedDisplay}</strong></>}
                  </span>
                )}
              </div>
            )}

            {/* URL field */}
            <div className="space-y-1.5">
              <Label htmlFor="bridge-url">Server URL</Label>
              <Input
                id="bridge-url"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://localhost:5010"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                ifc-lite will poll <code>{(localUrl || bridgeUrl).replace(/\/$/, '')}/api/ifc</code> every 2 seconds.
              </p>
            </div>

            {/* C# snippet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" />
                  Minimal C# server (ASP.NET Core)
                </Label>
                <Button variant="ghost" size="sm" onClick={copySnippet} className="h-6 px-2 text-xs gap-1">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs font-mono leading-relaxed max-h-48">
                {CSHARP_SNIPPET}
              </pre>
            </div>

            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-semibold">CORS required</p>
              <p>The C# server must set <code>Access-Control-Allow-Origin: *</code> so the browser can reach it. The snippet above includes this.</p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {bridgeConnected && (
              <Button variant="outline" onClick={handleDisconnect}>
                <WifiOff className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleConnect} disabled={!localUrl.trim() && !bridgeUrl}>
              {bridgeConnected ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reconnect</>
              ) : (
                <><Wifi className="h-4 w-4 mr-2" /> Connect</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

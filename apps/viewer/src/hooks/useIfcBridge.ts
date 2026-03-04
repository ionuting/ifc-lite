/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useIfcBridge — Live IFC source bridge
 *
 * Polls an external HTTP endpoint (e.g. a C# Nodify+xBIM server) for fresh
 * IFC content and loads it automatically when the content changes.
 *
 * Expected server contract (any language/framework):
 *   GET /api/ifc          → 200 text/plain <IFC STEP content>
 *                           or 304 Not Modified (when ETag matches)
 *   Response headers used: ETag (optional, for change detection)
 *
 * Minimal C# ASP.NET Core example:
 *   app.MapGet("/api/ifc", () => Results.Text(CurrentIfcContent, "text/plain"));
 *
 * CORS must be enabled on the C# server for browser access:
 *   builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));
 *   app.UseCors();
 */

import { useEffect, useRef, useCallback } from 'react';
import { useViewerStore } from '../store.js';
import { useIfc } from './useIfc.js';

const POLL_INTERVAL_MS = 2000;

/** Simple DJB2 hash to detect content changes without storing full IFC text */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function useIfcBridge() {
  const bridgeConnected = useViewerStore((s) => s.bridgeConnected);
  const bridgeUrl = useViewerStore((s) => s.bridgeUrl);
  const setBridgeError = useViewerStore((s) => s.setBridgeError);
  const setBridgeLastLoaded = useViewerStore((s) => s.setBridgeLastLoaded);
  const setBridgeLastEtag = useViewerStore((s) => s.setBridgeLastEtag);
  const setBridgeConnected = useViewerStore((s) => s.setBridgeConnected);

  const { loadFile } = useIfc();

  // Store last hash in a ref so the poll callback doesn't go stale
  const lastHashRef = useRef<string | null>(null);
  const lastEtagRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    const url = bridgeUrl.replace(/\/$/, '') + '/api/ifc';
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers: Record<string, string> = {
        Accept: 'text/plain,application/octet-stream,*/*',
      };
      if (lastEtagRef.current) {
        headers['If-None-Match'] = lastEtagRef.current;
      }

      const res = await fetch(url, { signal: controller.signal, headers });

      if (res.status === 304) {
        // Not modified — nothing to do
        setBridgeError(null);
        return;
      }

      if (!res.ok) {
        setBridgeError(`HTTP ${res.status}: ${res.statusText}`);
        return;
      }

      const text = await res.text();
      if (!text.trim()) {
        setBridgeError('Empty response from server');
        return;
      }

      const etag = res.headers.get('ETag') ?? null;
      const hash = etag ?? djb2(text);

      if (hash === lastHashRef.current) {
        // Same content, skip reload
        setBridgeError(null);
        return;
      }

      lastHashRef.current = hash;
      lastEtagRef.current = etag;
      setBridgeLastEtag(etag);

      const file = new File([text], 'bridge-model.ifc', { type: 'application/x-step' });

      // Re-open editor after loadFile resets viewer state
      const store = useViewerStore.getState();
      await loadFile(file);

      // Restore editor panel visibility after resetViewerState closed it
      if (store.editorPanelVisible) {
        useViewerStore.getState().setEditorPanelVisible(true);
        useViewerStore.getState().setRightPanelCollapsed(false);
      }

      setBridgeLastLoaded(new Date().toISOString());
      setBridgeError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setBridgeError(msg.includes('Failed to fetch')
        ? `Cannot reach ${url}. Is the server running?`
        : msg);
    }
  }, [bridgeUrl, loadFile, setBridgeError, setBridgeLastLoaded, setBridgeLastEtag]);

  useEffect(() => {
    if (!bridgeConnected) {
      // Abort any in-flight request when disconnecting
      abortRef.current?.abort();
      lastHashRef.current = null;
      lastEtagRef.current = null;
      return;
    }

    // Immediate first poll
    poll();

    const timerId = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timerId);
      abortRef.current?.abort();
    };
  }, [bridgeConnected, poll]);

  /** Toggle bridge on/off. Returns the new state. */
  const toggleBridge = useCallback(() => {
    const next = !bridgeConnected;
    setBridgeConnected(next);
    if (!next) {
      setBridgeError(null);
    }
    return next;
  }, [bridgeConnected, setBridgeConnected, setBridgeError]);

  return { toggleBridge };
}

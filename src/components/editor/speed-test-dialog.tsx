import * as React from "react";
import { flushSync } from "react-dom";

import type { GameMap } from "@/lib/map/types";
import type { SceneAssets } from "@/lib/wad/assets";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import {
  createSceneRenderer,
  type SceneRendererKind,
} from "@/lib/preview/scene-renderer";
import {
  animationClock,
  freedoomSlot,
  gpuName,
  loadFreedoomScene,
  runSpeedTest,
  type SpeedTestClock,
  speedTestFrames,
  speedTestReport,
  type SpeedTestScene,
} from "@/lib/preview/speed-test";

const renderRows = 400;
const progressEvery = 30;

type Source = "freedoom" | "map";

type Phase =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "running"; renderer: SceneRendererKind; frame: number }
  | { kind: "done"; report: string }
  | { kind: "failed"; message: string };

const hiddenReason = new Error("The page was hidden.");

const runningNames: Record<SceneRendererKind, string> = {
  columns: "column renderer",
  webgl: "WebGL renderer",
};

interface SpeedTestDialogProps {
  map: GameMap;
  mapName: string;
  assets: SceneAssets;
  sky: string;
  customSprites?: ReadonlyMap<number, string | null>;
  clock?: SpeedTestClock;
  loadScene?: () => Promise<SpeedTestScene>;
  onClose: () => void;
}

export function SpeedTestDialog({
  map,
  mapName,
  assets,
  sky,
  customSprites,
  clock = animationClock,
  loadScene = loadFreedoomScene,
  onClose,
}: SpeedTestDialogProps) {
  const [source, setSource] = React.useState<Source>("freedoom");
  const [phase, setPhase] = React.useState<Phase>({ kind: "ready" });
  const [isCopied, setIsCopied] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const running = React.useRef<AbortController | null>(null);
  const results = React.useRef<HTMLPreElement>(null);

  React.useEffect(() => () => running.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    running.current = controller;
    const canvases: HTMLCanvasElement[] = [];
    // Frames stop while the page is hidden, which would spoil the timings.
    const onHidden = () => {
      if (document.hidden) controller.abort(hiddenReason);
    };
    document.addEventListener("visibilitychange", onHidden);
    const wakeLock = navigator.wakeLock?.request("screen").catch(() => null);
    flushSync(() => {
      setIsCopied(false);
      setPhase({ kind: "loading" });
    });
    try {
      const scene =
        source === "freedoom"
          ? await untilAborted(loadScene(), controller.signal)
          : { name: mapName, map, assets, sky, customSprites };
      controller.signal.throwIfAborted();
      flushSync(() =>
        setPhase({ kind: "running", renderer: "columns", frame: 0 }),
      );
      const result = await runSpeedTest({
        scene,
        clock,
        signal: controller.signal,
        createRenderer: (kind) => {
          const host = stage.current;
          if (!host) return null;
          const canvas = document.createElement("canvas");
          canvases.push(canvas);
          canvas.className = "block size-full";
          host.replaceChildren(canvas);
          const renderer = createSceneRenderer(canvas, kind, 1, 1);
          if (!renderer) return null;
          const size = renderer.sizeFor(
            host.clientWidth,
            host.clientHeight,
            renderRows,
          );
          renderer.resize(size.width, size.height);
          return renderer;
        },
        device: () => ({
          browser: navigator.userAgent,
          gpu: gpuName(),
          pixelRatio: globalThis.devicePixelRatio || 1,
          hasTouch: navigator.maxTouchPoints > 0,
          stage: {
            width: stage.current?.clientWidth ?? 0,
            height: stage.current?.clientHeight ?? 0,
          },
        }),
        onProgress: (renderer, frame) => {
          if (frame % progressEvery === 0) {
            setPhase({ kind: "running", renderer, frame });
          }
        },
      });
      setPhase({ kind: "done", report: speedTestReport(result) });
    } catch (error) {
      if (controller.signal.reason === hiddenReason) {
        setPhase({
          kind: "failed",
          message:
            "the page was hidden, which pauses drawing. Keep it in view and run it again.",
        });
      } else if (controller.signal.aborted) setPhase({ kind: "ready" });
      else {
        setPhase({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      document.removeEventListener("visibilitychange", onHidden);
      void wakeLock?.then((lock) => lock?.release());
      // Browsers keep only a few WebGL contexts per page and drop the oldest,
      // which may be the 3D view's, so the test's go at once.
      for (const canvas of canvases) {
        canvas
          .getContext("webgl2")
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext();
      }
      stage.current?.replaceChildren();
      if (running.current === controller) running.current = null;
    }
  };

  const cancel = () => running.current?.abort();

  const copy = async (report: string) => {
    try {
      await navigator.clipboard.writeText(report);
      setIsCopied(true);
    } catch {
      if (results.current) getSelection()?.selectAllChildren(results.current);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        cancel();
        onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[680px]">
        <DialogHeader>
          <DialogTitle>3D speed test</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <div
            ref={stage}
            aria-hidden="true"
            className="aspect-[8/5] w-full overflow-hidden rounded-[3px] bg-muted"
            hidden={phase.kind !== "running"}
          />
          {phase.kind === "ready" ? (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                Flies a fixed path, first with the column renderer and then with
                WebGL, and makes a few edits along the way. Your map and 3D view
                stay as they are.
              </p>
              <SegmentedControl
                aria-label="Map to test"
                className="self-start"
                value={source}
                onValueChange={(next) => setSource(next as Source)}
              >
                <SegmentedControlItem value="freedoom">
                  Freedoom {freedoomSlot}
                </SegmentedControlItem>
                <SegmentedControlItem value="map">
                  This map
                </SegmentedControlItem>
              </SegmentedControl>
              <p className="m-0 text-sm text-muted-foreground">
                {source === "freedoom"
                  ? "Results compare between devices."
                  : "Results compare only with runs on this same map."}
              </p>
            </>
          ) : null}
          {phase.kind === "running" ? (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              Testing the {runningNames[phase.renderer]}, frame {phase.frame} of{" "}
              {speedTestFrames}
            </p>
          ) : null}
          {phase.kind === "loading" ? (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              Loading the map
            </p>
          ) : null}
          {phase.kind === "done" ? (
            <pre
              ref={results}
              aria-label="Results"
              className="m-0 overflow-x-auto rounded-[3px] border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap text-foreground"
            >
              {phase.report}
            </pre>
          ) : null}
          {phase.kind === "failed" ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              The speed test stopped: {phase.message}
            </p>
          ) : null}
        </div>
        <DialogFooter className="justify-end">
          {phase.kind === "running" || phase.kind === "loading" ? (
            <Button onClick={cancel}>Cancel</Button>
          ) : (
            <>
              {phase.kind === "done" ? (
                <Button onClick={() => copy(phase.report)}>
                  {isCopied ? "Copied" : "Copy results"}
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={() => {
                  void start();
                }}
              >
                {phase.kind === "ready" ? "Start" : "Run again"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    promise.then(resolve, reject);
  });
}

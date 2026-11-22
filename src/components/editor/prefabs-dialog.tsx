import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import type { GameMap } from "@/lib/map/types";

import { MapPlan } from "@/components/map-plan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  listPrefabs,
  type Prefab,
  removePrefab,
  savePrefab,
} from "@/lib/editor/prefabs";

interface PrefabsDialogProps {
  // What the selection would save, or null with nothing to save.
  selected: GameMap | null;
  suggestedName: string;
  onPlace: (fragment: GameMap) => void;
  onClose: () => void;
}

export function PrefabsDialog({
  selected,
  suggestedName,
  onPlace,
  onClose,
}: PrefabsDialogProps) {
  const [prefabs, setPrefabs] = React.useState<Prefab[] | null>(null);
  const [name, setName] = React.useState(suggestedName);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    listPrefabs()
      .then((found) => {
        if (active) setPrefabs(found);
      })
      .catch(() => {
        if (active) setPrefabs([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (!selected) return;
    try {
      const saved = await savePrefab(name, selected);
      setPrefabs((current) => [...(current ?? []), saved]);
      setProblem(null);
    } catch {
      setProblem("Couldn't save the prefab in this browser.");
    }
  };

  const remove = async (id: string) => {
    try {
      await removePrefab(id);
      setPrefabs((current) => (current ?? []).filter((item) => item.id !== id));
      setProblem(null);
    } catch {
      setProblem("Couldn't remove the prefab.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="max-h-[620px] w-[560px]">
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>Prefabs</DialogTitle>
            <DialogDescription>
              {prefabs === null
                ? "Loading"
                : prefabs.length === 0
                  ? "None saved"
                  : `${prefabs.length} saved`}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              aria-label="Prefab name"
              maxLength={40}
              placeholder="Name"
              value={name}
              disabled={!selected}
              onValueChange={setName}
            />
            <Button type="submit" disabled={!selected}>
              <Plus size={14} aria-hidden="true" />
              Save the selection
            </Button>
          </form>
          {selected ? null : (
            <p className="m-0 text-sm text-muted-foreground">
              Select a room or a thing to save it as a prefab.
            </p>
          )}
          {prefabs && prefabs.length > 0 ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {prefabs.map((prefab) => (
                <li
                  key={prefab.id}
                  className="flex items-center gap-3 rounded-[3px] border border-border bg-card px-3 py-2"
                >
                  <MapPlan
                    map={prefab.fragment}
                    className="h-12 w-16 shrink-0 bg-background"
                  />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate">{prefab.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {contentsOf(prefab.fragment)}
                    </span>
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => {
                      onPlace(prefab.fragment);
                      onClose();
                    }}
                  >
                    Place
                  </Button>
                  <Button
                    aria-label={`Remove ${prefab.name}`}
                    onClick={() => void remove(prefab.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter className="justify-between">
          <p
            role={problem ? "alert" : undefined}
            className={
              problem
                ? "m-0 min-w-0 text-destructive"
                : "m-0 min-w-0 text-muted-foreground"
            }
          >
            {problem ?? "They stay in this browser, for every map."}
          </p>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function contentsOf(fragment: GameMap) {
  return [
    counted(fragment.sectors.length, "room"),
    counted(fragment.things.length, "thing"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function counted(total: number, one: string) {
  return total === 0 ? "" : `${total} ${total === 1 ? one : `${one}s`}`;
}

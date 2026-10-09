import React, { useEffect, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalSubtitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { InputNumber } from '@/components/ui/input-number';
import { MultiSelect } from '@/components/ui/multi-select';
import { WEEKDAYS } from '@/shared/format';
import { fetchBuildings, runOptimizer } from '@/shared/energyApi';
import type { BuildingRec, OptimizerParams } from '@/Interfaces';

interface RunOptimizerDialogProps {
  /** Called after a run completes successfully so the parent can refresh. */
  onComplete: () => void;
  /** Visual style of the trigger button. */
  triggerVariant?: 'solid' | 'soft' | 'outline';
  triggerLabel?: string;
}

const DEFAULT_PARAMS: OptimizerParams = {
  hourStart: 7,
  hourEnd: 22,
  maxOccupancyToEvacuate: 2,
  days: ['M', 'T', 'W', 'R', 'F'],
  excludeBuildings: [],
};

/**
 * Modal that exposes the Section-4 optimizer parameters (weekdays, hour window,
 * max occupancy to evacuate, excluded buildings) and triggers a run. Mirrors the
 * backend {@link OptimizationRun#runOptimization} signature exactly.
 */
export default function RunOptimizerDialog({
  onComplete,
  triggerVariant = 'solid',
  triggerLabel = 'Run optimizer',
}: RunOptimizerDialogProps) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<OptimizerParams>(DEFAULT_PARAMS);
  const [buildings, setBuildings] = useState<BuildingRec[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || buildings.length) return;
    fetchBuildings()
      .then(setBuildings)
      .catch(() => setBuildings([]));
  }, [open, buildings.length]);

  const toggleDay = (day: string) => {
    setParams((p) => {
      const has = p.days.includes(day);
      const next = has ? p.days.filter((d) => d !== day) : [...p.days, day];
      return { ...p, days: next };
    });
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await runOptimizer(params);
      setOpen(false);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed.');
    } finally {
      setRunning(false);
    }
  };

  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.id }));
  const daysValid = params.days.length > 0;
  const windowValid = params.hourEnd > params.hourStart;

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Button variant={triggerVariant} appearance="accent" onClick={() => setOpen(true)}>
        <Play className="size-4" />
        {triggerLabel}
      </Button>
      <ModalContent width={560}>
        <ModalHeader>
          <ModalTitle>Run consolidation optimizer</ModalTitle>
          <ModalSubtitle>
            Relocates movable sections into already-busy buildings — keeping every
            class on its exact days and times — to free whole building-hours for HVAC
            setback.
          </ModalSubtitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-5 py-1">
            {/* Weekdays */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Weekdays to optimize</span>
              <div className="flex flex-wrap gap-4">
                {WEEKDAYS.map(({ day, label }) => (
                  <label key={day} className="flex items-center gap-2 text-sm text-foreground">
                    <Switch
                      checked={params.days.includes(day)}
                      onCheckedChange={() => toggleDay(day)}
                      size="sm"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Hour window */}
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="hourStart" className="text-sm font-medium text-foreground">
                  Start hour
                </label>
                <InputNumber
                  id="hourStart"
                  value={params.hourStart}
                  min={0}
                  max={23}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, hourStart: Number(e.target.value) || 0 }))
                  }
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="hourEnd" className="text-sm font-medium text-foreground">
                  End hour
                </label>
                <InputNumber
                  id="hourEnd"
                  value={params.hourEnd}
                  min={1}
                  max={24}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, hourEnd: Number(e.target.value) || 0 }))
                  }
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="maxOcc" className="text-sm font-medium text-foreground">
                  Max occupancy to evacuate
                </label>
                <InputNumber
                  id="maxOcc"
                  value={params.maxOccupancyToEvacuate}
                  min={1}
                  max={4}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      maxOccupancyToEvacuate: Number(e.target.value) || 1,
                    }))
                  }
                  className="w-28"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              A building is a candidate to empty in a given hour only when it has at
              most this many sections running there (1–4). Hour window default 7–22
              (7am–10pm).
            </p>

            {/* Exclude buildings */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Exclude buildings (optional)
              </span>
              <MultiSelect
                options={buildingOptions}
                values={params.excludeBuildings}
                onValuesChange={(vals) =>
                  setParams((p) => ({ ...p, excludeBuildings: vals }))
                }
                placeholder="Keep all buildings in scope"
              />
              <span className="text-xs text-muted-foreground">
                Excluded buildings are never emptied and never used as a destination.
              </span>
            </div>

            {error ? (
              <div className="rounded-md bg-[var(--c3-style-basic-bg-danger)] px-3 py-2 text-sm text-[var(--c3-style-basic-fg-danger)]">
                {error}
              </div>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" appearance="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="solid"
            appearance="accent"
            onClick={run}
            disabled={running || !daysValid || !windowValid}
          >
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Optimizing…
              </>
            ) : (
              <>
                <Play className="size-4" />
                Run optimizer
              </>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

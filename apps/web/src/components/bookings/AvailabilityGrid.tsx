import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  dragRange,
  type GridDay,
  type GridSlot,
  nextFreeSlot,
} from "#/lib/availability";
import { formatUtcTime } from "#/lib/datetime";

/** A time range picked on the grid, kept highlighted until it is booked. */
export interface GridSelection {
  endsAt: string;
  startsAt: string;
}

interface AvailabilityGridProps {
  grid: GridDay[];
  /** The loader's "now" (ISO), so server and browser agree on what is past. */
  nowIso: string;
  /**
   * Called with the start the form should prefill. A drag over several slots
   * also passes the end of the last one; a click leaves it out.
   */
  onPick: (startIso: string, endIso?: string) => void;
  /**
   * The picked range. Its free slots stay highlighted, so a slot someone else
   * books in the meantime drops out of the highlight by itself.
   */
  selection: GridSelection | null;
}

/** A drag in progress: one day column, from the pressed slot to the pointer. */
interface Drag {
  anchor: number;
  current: number;
  dayIndex: number;
}

const CELL_STYLE: Record<GridSlot["state"], string> = {
  booked: "bg-muted text-muted-foreground hover:bg-muted/70",
  free: "bg-primary/10 text-foreground hover:bg-primary/20",
  past: "bg-transparent text-muted-foreground/50",
};

export default function AvailabilityGrid({
  grid,
  nowIso,
  onPick,
  selection,
}: AvailabilityGridProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const range = drag
    ? dragRange(grid[drag.dayIndex]?.slots ?? [], drag.anchor, drag.current)
    : null;

  const finishDrag = useCallback(() => {
    if (drag && range) {
      const slots = grid[drag.dayIndex]?.slots ?? [];
      const first = slots[range.from];
      const last = slots[range.to];
      if (first && last) {
        setMessage(null);
        onPick(first.startsAt, last.endsAt);
      }
    }
    setDrag(null);
  }, [drag, grid, onPick, range]);

  // Release anywhere, even outside the grid, to commit what was covered. A
  // cancelled pointer or Escape drops the drag without picking.
  useEffect(() => {
    if (!drag) {
      return;
    }
    const cancel = () => setDrag(null);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
      }
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, finishDrag]);

  const handleDragStart = useCallback(
    (
      event: PointerEvent<HTMLButtonElement>,
      dayIndex: number,
      index: number
    ) => {
      if (event.button !== 0) {
        return;
      }
      setDrag({ anchor: index, current: index, dayIndex });
    },
    []
  );

  // Pointer events from a touch stay on the pressed cell, so find the cell
  // under the finger by position. Cells in other day columns are ignored.
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag) {
        return;
      }
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-slot]");
      if (
        cell &&
        Number(cell.dataset.day) === drag.dayIndex &&
        Number(cell.dataset.slot) !== drag.current
      ) {
        setDrag({ ...drag, current: Number(cell.dataset.slot) });
      }
    },
    [drag]
  );

  const handlePick = useCallback(
    (slot: GridSlot) => {
      const target =
        slot.state === "free"
          ? slot.startsAt
          : nextFreeSlot(
              grid,
              slot.state === "booked" ? (slot.bookedUntil ?? nowIso) : nowIso
            );
      if (target === null) {
        setMessage("No free slot in the next 7 days.");
        return;
      }
      setMessage(null);
      onPick(target);
    },
    [grid, nowIso, onPick]
  );

  // While dragging, the live range replaces the earlier selection.
  const isSelected = (dayIndex: number, slot: GridSlot, slotIndex: number) => {
    if (drag) {
      return (
        drag.dayIndex === dayIndex &&
        range !== null &&
        slotIndex >= range.from &&
        slotIndex <= range.to
      );
    }
    return (
      selection !== null &&
      slot.state === "free" &&
      slot.startsAt >= selection.startsAt &&
      slot.endsAt <= selection.endsAt
    );
  };

  // One row per 30 minutes: each cell holds two stacked 15-minute halves.
  const rows = (grid.at(0)?.slots ?? []).filter((_, index) => index % 2 === 0);

  return (
    <div>
      <div className="overflow-x-auto" onPointerMove={handlePointerMove}>
        <table className="w-full border-separate border-spacing-1 text-xs">
          <caption className="sr-only">
            Availability for the next 7 days, in UTC
          </caption>
          <thead>
            <tr>
              <th className="w-12" scope="col">
                <span className="sr-only">Time</span>
              </th>
              {grid.map((d) => (
                <th
                  className="font-medium text-foreground"
                  key={d.day}
                  scope="col"
                >
                  {d.day.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.startsAt}>
                <th
                  className="text-right font-normal text-muted-foreground"
                  scope="row"
                >
                  {formatUtcTime(row.startsAt)}
                </th>
                {grid.map((d, dayIndex) => {
                  const first = d.slots[rowIndex * 2];
                  const second = d.slots[rowIndex * 2 + 1];
                  if (!first) {
                    return <td key={d.day} />;
                  }
                  return (
                    <td key={d.day}>
                      <div className="flex flex-col overflow-hidden rounded-sm">
                        <SlotButton
                          dayIndex={dayIndex}
                          onDragStart={handleDragStart}
                          onPick={handlePick}
                          selected={isSelected(dayIndex, first, rowIndex * 2)}
                          slot={first}
                          slotIndex={rowIndex * 2}
                        />
                        {second ? (
                          <SlotButton
                            dayIndex={dayIndex}
                            onDragStart={handleDragStart}
                            onPick={handlePick}
                            selected={isSelected(
                              dayIndex,
                              second,
                              rowIndex * 2 + 1
                            )}
                            showLabel={
                              !(
                                first.state === "booked" &&
                                second.state === "booked"
                              )
                            }
                            slot={second}
                            slotIndex={rowIndex * 2 + 1}
                          />
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        aria-live="polite"
        className="mt-2 min-h-5 text-muted-foreground text-sm"
      >
        {message}
      </p>
    </div>
  );
}

function SlotButton({
  dayIndex,
  onDragStart,
  onPick,
  selected,
  showLabel = true,
  slot,
  slotIndex,
}: {
  dayIndex: number;
  onDragStart: (
    event: PointerEvent<HTMLButtonElement>,
    dayIndex: number,
    slotIndex: number
  ) => void;
  onPick: (slot: GridSlot) => void;
  /** True while a drag covers this slot or it is part of the picked range. */
  selected: boolean;
  /** False on the second half of a fully booked cell, so "Booked" shows once. */
  showLabel?: boolean;
  slot: GridSlot;
  slotIndex: number;
}) {
  const isFree = slot.state === "free";
  const time = formatUtcTime(slot.startsAt);
  const label = { booked: "Booked", free: "Free", past: "Past" }[slot.state];

  // A free slot starts a drag on press (a plain click is a one-slot drag), so
  // its click only counts for the keyboard, where `detail` is 0. Other slots
  // jump to the next free time on click.
  const handleClick = useCallback(
    (
      event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>
    ) => {
      if (!isFree || event.detail === 0) {
        onPick(slot);
      }
    },
    [isFree, onPick, slot]
  );
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (isFree) {
        onDragStart(event, dayIndex, slotIndex);
      }
    },
    [dayIndex, isFree, onDragStart, slotIndex]
  );

  return (
    <button
      aria-label={`${slot.startsAt.slice(0, 10)} ${time} ${label}`}
      className={`h-4 w-full select-none text-[10px] leading-4 ${
        selected ? "bg-primary/50" : CELL_STYLE[slot.state]
      } ${isFree ? "touch-none" : ""}`}
      data-day={dayIndex}
      data-slot={slotIndex}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      type="button"
    >
      {slot.state === "booked" && showLabel ? "Booked" : ""}
    </button>
  );
}

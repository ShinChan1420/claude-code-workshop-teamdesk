import { useCallback, useState } from "react";
import { type GridDay, type GridSlot, nextFreeSlot } from "#/lib/availability";
import { formatUtcTime } from "#/lib/datetime";

interface AvailabilityGridProps {
  grid: GridDay[];
  /** The loader's "now" (ISO), so server and browser agree on what is past. */
  nowIso: string;
  /** Called with the start of the slot the form should prefill. */
  onPick: (startIso: string) => void;
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
}: AvailabilityGridProps) {
  const [message, setMessage] = useState<string | null>(null);

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

  // One row per 30 minutes: each cell holds two stacked 15-minute halves.
  const rows = (grid.at(0)?.slots ?? []).filter((_, index) => index % 2 === 0);

  return (
    <div>
      <div className="overflow-x-auto">
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
                {grid.map((d) => {
                  const first = d.slots[rowIndex * 2];
                  const second = d.slots[rowIndex * 2 + 1];
                  if (!first) {
                    return <td key={d.day} />;
                  }
                  return (
                    <td key={d.day}>
                      <div className="flex flex-col overflow-hidden rounded-sm">
                        <SlotButton onPick={handlePick} slot={first} />
                        {second ? (
                          <SlotButton
                            onPick={handlePick}
                            showLabel={
                              !(
                                first.state === "booked" &&
                                second.state === "booked"
                              )
                            }
                            slot={second}
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
  onPick,
  showLabel = true,
  slot,
}: {
  onPick: (slot: GridSlot) => void;
  /** False on the second half of a fully booked cell, so "Booked" shows once. */
  showLabel?: boolean;
  slot: GridSlot;
}) {
  const handleClick = useCallback(() => onPick(slot), [onPick, slot]);
  const time = formatUtcTime(slot.startsAt);
  const label = { booked: "Booked", free: "Free", past: "Past" }[slot.state];

  return (
    <button
      aria-label={`${slot.startsAt.slice(0, 10)} ${time} ${label}`}
      className={`h-4 w-full text-[10px] leading-4 ${CELL_STYLE[slot.state]}`}
      onClick={handleClick}
      type="button"
    >
      {slot.state === "booked" && showLabel ? "Booked" : ""}
    </button>
  );
}

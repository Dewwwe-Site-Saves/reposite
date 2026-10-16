/** The strip above a section's fields: a few labelled read-only facts about what is configured. */
export function SummaryBar({ items }: { items: { label: string; value: React.ReactNode }[] }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 rounded-md bg-popover p-3.5 text-sm">
            {items.map((item) => (
                <span key={item.label} className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-muted-foreground">{item.label} :</span>
                    <span className="truncate">{item.value}</span>
                </span>
            ))}
        </div>
    );
}

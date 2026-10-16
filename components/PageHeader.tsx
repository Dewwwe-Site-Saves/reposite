/** The title block every page opens with; `action` holds the buttons that sit on the same line. */
export function PageHeader({
    title,
    subtitle,
    action,
}: {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="text-3xl font-semibold tracking-[-0.02em]">{title}</h1>
                {subtitle && <p className="text-sm">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

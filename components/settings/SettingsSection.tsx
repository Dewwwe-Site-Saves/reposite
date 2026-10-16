import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';

/** The card every settings section is drawn in: header with an icon, body, and a footer action bar. */
export function SettingsSection({
    icon,
    title,
    description,
    badge,
    footer,
    children,
}: {
    icon: IconSvgElement;
    title: string;
    description?: React.ReactNode;
    /** Sits on the title line, for a state the section wants to flag. */
    badge?: React.ReactNode;
    /** The action bar under a separator: status on the left, buttons on the right. */
    footer?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-5 rounded-lg bg-card p-5">
            <div className="flex items-center gap-3 border-b border-muted pb-4">
                <HugeiconsIcon icon={icon} size={24} className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-3">
                        <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-[-0.01em]">
                            {title}
                        </h2>
                        {badge}
                    </div>
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
            </div>

            {children}

            {footer && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2.5">
                    {footer}
                </div>
            )}
        </section>
    );
}

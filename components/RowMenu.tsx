'use client';

import { Menu } from '@base-ui/react/menu';
import { MoreVerticalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

export interface RowMenuItem {
    label: string;
    onSelect: () => void;
}

/** The "more" menu at the end of a table row. Clicks stay inside it: the row around it is usually clickable too, and React lets a click in the popup bubble to the row even though the popup is rendered elsewhere. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
    return (
        <Menu.Root>
            <Menu.Trigger
                aria-label={label}
                className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={(event) => event.stopPropagation()}
            >
                <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner align="end" sideOffset={4} className="z-50">
                    <Menu.Popup
                        className="min-w-40 rounded-md border border-border bg-popover p-1 text-sm shadow-lg outline-none"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {items.map((item) => (
                            <Menu.Item
                                key={item.label}
                                className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-muted"
                                onClick={item.onSelect}
                            >
                                {item.label}
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

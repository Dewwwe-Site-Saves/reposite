'use client';

/** A date in the viewer's own timezone and locale. Server components hand it the ISO string: the server's clock zone is not the reader's. */
export function LocalDateTime({ value }: { value: string }) {
    return (
        <time dateTime={value} suppressHydrationWarning>
            {new Date(value).toLocaleString()}
        </time>
    );
}

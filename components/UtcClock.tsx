'use client';

import { useEffect, useState } from 'react';

/** Runs are timestamped in UTC, so the header shows UTC rather than the browser's zone. */
export function UtcClock() {
    const [time, setTime] = useState<string | null>(null);

    useEffect(() => {
        const tick = () => setTime(new Date().toISOString().slice(11, 19));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    // Placeholder until mounted: the server cannot render a second the client would agree with.
    return <span className="tabular-nums">UTC {time ?? '--:--:--'}</span>;
}

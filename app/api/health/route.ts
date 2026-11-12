import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/engine/cancel';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Unauthenticated probe for the Docker HEALTHCHECK and the stack manager: 200 when the database answers, 503 otherwise. Public in `proxy.ts`. */
export async function GET(): Promise<NextResponse> {
    try {
        await prisma.$queryRawUnsafe('SELECT 1');
        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error(`[health] ${errorMessage(error)}`);
        return NextResponse.json({ status: 'error' }, { status: 503 });
    }
}

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/**
 * Session gate in front of every route. Only the cookie signature is checked here (no database in the proxy): pages send the visitor to `/login`, API routes answer 401. The login page itself redirects to `/setup` while no user exists, and the setup page back to `/login` once one does, both from the database.
 */

const PUBLIC_PATHS = new Set([
    '/login',
    '/setup',
    '/api/auth/login',
    '/api/auth/setup',
    '/api/auth/logout',
    '/api/health',
]);

export async function proxy(request: NextRequest): Promise<NextResponse> {
    // Trailing slashes are normalized by Next.js after the proxy: compare without them.
    const pathname = request.nextUrl.pathname.replace(/\/+$/, '') || '/';
    if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token && (await verifySessionToken(token))) return NextResponse.next();

    if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
}

export const config = {
    // Everything except Next.js assets and the app icon, which the login page must be able to load without a session.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

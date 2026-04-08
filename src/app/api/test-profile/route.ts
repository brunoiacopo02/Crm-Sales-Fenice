import { NextResponse } from 'next/server';
import { getGdoRpgProfile } from '@/app/actions/rpgProfileActions';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || '5fab6b1b-8bd7-49c7-b088-8a96efac8930'; // GDO 114

    try {
        const profile = await getGdoRpgProfile(userId);
        return NextResponse.json({ success: true, level: profile.level, stage: profile.stage?.name });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message, stack: e.stack?.split('\n').slice(0, 5) }, { status: 500 });
    }
}

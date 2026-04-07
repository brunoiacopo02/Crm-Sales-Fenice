import { ArchiveClient } from "./ArchiveClient";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export default async function ArchivePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/');
    }

    // Fetch employees for dropdowns
    const allUsers = await db.select({
        id: users.id,
        name: users.name,
        role: users.role
    }).from(users);

    const gdoUsers = allUsers.filter(u => u.role === 'GDO');
    const salesUsers = allUsers.filter(u => u.role === 'VENDITORE');

    return (
        <div className="flex-1 bg-[#111111] min-h-screen text-gray-100 p-4 sm:p-6 md:p-8 pt-6 sm:pt-8 md:pt-10 overflow-y-auto">
            <ArchiveClient gdoUsers={gdoUsers} salesUsers={salesUsers} />
        </div>
    );
}

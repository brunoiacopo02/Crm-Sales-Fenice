import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getUserCreatures } from "@/app/actions/creatureActions";
import { getAllOffers, getGdoUsersForTrading } from "@/app/actions/tradingActions";
import dynamic from "next/dynamic";

const TradingClient = dynamic(() => import("./TradingClient"), { loading: () => <div className="animate-pulse space-y-4"><div className="h-10 bg-ash-200 rounded-lg w-1/3" /><div className="grid grid-cols-2 gap-4"><div className="h-64 bg-ash-100 rounded-xl" /><div className="h-64 bg-ash-100 rounded-xl" /></div></div> });

export default async function TradingPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const role = user.user_metadata?.role;
    if (role !== "GDO") redirect("/");

    const [myCreatures, offers, gdoUsers] = await Promise.all([
        getUserCreatures(user.id),
        getAllOffers(user.id),
        getGdoUsersForTrading(user.id),
    ]);

    return (
        <TradingClient
            userId={user.id}
            myCreatures={myCreatures}
            offers={offers}
            gdoUsers={gdoUsers}
        />
    );
}
